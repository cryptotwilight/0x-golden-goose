// ─────────────────────────────────────────────────────────────────────────────
// Executor Agent
//
// Receives approved TradeDecisions from RiskManager via AXL, then either:
//   - SIMULATE mode (no PRIVATE_KEY): logs the swap params, skips on-chain tx
//   - LIVE mode (PRIVATE_KEY set): submits the swap on Sepolia via Uniswap v3
//
// All results (success or failure) are stored on 0G and broadcast back.
// ─────────────────────────────────────────────────────────────────────────────

import { BaseAgent } from './base-agent.js';
import { executeSwap, applySlippage, tokenAddress, ERC20_ABI, getQuote } from '../lib/uniswap.js';
import { getSepoliaClient, sepoliaFailover } from '../lib/viem-client.js';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
import { formatEther } from 'viem';
import { config, TOKENS } from '../config/index.js';
import type {
  AxlMessage,
  TradeDecision,
  TradeResult,
  TradeStatus,
} from '../types/index.js';

const FUND_ABI = parseAbi([
  'function drawdown(address user, address token, uint256 amount) external',
  'function returnFunds(address user, address tokenReturned, uint256 amountReturned, address tokenCleared, uint256 amountCleared) external',
  'function realBalance(address user, address token) view returns (uint256)',
  'function notionalBalance(address user, address token) view returns (uint256)',
  'function inflightFunds(address user, address token) view returns (uint256)',
  'function getTradeLimit(address user, address token) view returns (uint256)',
  'function getBotWallet(address user) view returns (address)',
]);

export class Executor extends BaseAgent {
  private pendingDecision: TradeDecision | null = null;
  private totalTrades: number = 0;
  private totalSuccess: number = 0;
  private totalFailed: number = 0;
  private liveMode: boolean = false;
  private walletAddress: string = '--';
  private walletBalance: string = '--';
  
  // Dashboard
  public latestResult: TradeResult | null = null;
  public tradeHistory: TradeResult[] = [];
  public fundMetrics: any = null;
  public lastActionAt: number = 0;
  public lastBlockNumber: number = 0;

  constructor() {
    super('executor');
  }

  protected async onInit(): Promise<void> {
    this.liveMode = !!config.privateKey;
    if (this.liveMode) {
      const rawKey = config.privateKey as string;
      const hexKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
      const account = privateKeyToAccount(hexKey);
      this.walletAddress = account.address;
      console.log(`[executor] Live mode -- will submit swaps on Sepolia`);
      // fetch initial balance
      await this.refreshBalance();
    } else {
      console.log(`[executor] Simulate mode -- no PRIVATE_KEY set`);
    }
  }

  private async refreshBalance(): Promise<void> {
    try {
      const client = getSepoliaClient();
      const bal = await client.getBalance({ address: this.walletAddress as `0x${string}` });
      const ethStr = parseFloat(formatEther(bal)).toFixed(4) + ' ETH';

      const usdcBal = await client.readContract({
        address: TOKENS.sepolia.USDC,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.walletAddress as `0x${string}`],
      }) as bigint;
      const usdcStr = (Number(usdcBal) / 1e6).toFixed(2) + ' USDC';
      this.walletBalance = `${ethStr} | ${usdcStr}`;

      if (config.fundContractAddress) {
        const fund = config.fundContractAddress as `0x${string}`;
        const vaultOwner = (config.fundOwnerAddress || this.walletAddress) as `0x${string}`;

        const tokens = { WETH: TOKENS.sepolia.WETH, USDC: TOKENS.sepolia.USDC };
        const metrics: any = { address: fund, owner: vaultOwner, tokens: {} };

        metrics.botWallet = await client.readContract({ address: fund, abi: FUND_ABI, functionName: 'getBotWallet', args: [vaultOwner] });

        for (const [sym, addr] of Object.entries(tokens)) {
          const real = await client.readContract({ address: fund, abi: FUND_ABI, functionName: 'realBalance', args: [vaultOwner, addr] }) as bigint;
          const notional = await client.readContract({ address: fund, abi: FUND_ABI, functionName: 'notionalBalance', args: [vaultOwner, addr] }) as bigint;
          const inflight = await client.readContract({ address: fund, abi: FUND_ABI, functionName: 'inflightFunds', args: [vaultOwner, addr] }) as bigint;
          const limit = await client.readContract({ address: fund, abi: FUND_ABI, functionName: 'getTradeLimit', args: [vaultOwner, addr] }) as bigint;

          const divisor = sym === 'USDC' ? 1e6 : 1e18;
          const harvestable = notional > limit ? notional - limit : 0n;

          metrics.tokens[sym] = {
            real: Number(real) / divisor,
            notional: Number(notional) / divisor,
            inflight: Number(inflight) / divisor,
            limit: Number(limit) / divisor,
            harvestable: Number(harvestable) / divisor,
          };
        }
        this.fundMetrics = metrics;
      }
    } catch (e) {
      console.error('[executor] Error fetching balances:', e);
    }
  }

  protected async onStart(): Promise<void> {
    console.log(`[executor] Waiting for approved decisions from RiskManager...`);
  }

  protected async onStop(): Promise<void> {}

  async onMessage(msg: AxlMessage): Promise<void> {
    if (msg.type !== 'DECISION') return;
    const decision = msg.payload as TradeDecision;

    if (!decision.approved) {
      console.log(`[executor] Decision rejected (${decision.reason}) -- skipping`);
      return;
    }

    console.log(`[executor] [FIRE] Executing approved trade -- signal ${decision.signalId}`);
    this.pendingDecision = decision;
    const result = await this.executeTrade(decision);
    this.latestResult = result;
    this.lastActionAt = Date.now();
    if (result.blockNumber) this.lastBlockNumber = result.blockNumber;
    this.tradeHistory.push(result);
    if (this.tradeHistory.length > 50) this.tradeHistory.shift();

    // Persist to 0G
    await this.persistState({
      totalTrades: this.totalTrades,
      recentResults: [result],
    });
    await this.storage.appendEvent('RESULT', result);

    // Refresh balance after each trade
    if (this.liveMode) await this.refreshBalance();

    // Broadcast result back (could be picked up by a monitor/dashboard agent)
    await this.send('scout', 'RESULT', result);
  }

  private async executeTrade(decision: TradeDecision): Promise<TradeResult> {
    this.totalTrades++;
    const amountIn = decision.adjustedAmountIn ?? config.tradeAmountWei;
    const base: Omit<TradeResult, 'status' | 'txHash' | 'amountOut' | 'gasUsed' | 'error'> = {
      signalId: decision.signalId,
      direction: decision.direction,
      executionPrice: decision.price,
      amountIn,
      timestamp: Date.now(),
      executorEns: this.ensName,
    };

    if (!this.liveMode) {
      console.log(`[executor] [SIMULATE] Would swap ${amountIn} tokenIn → tokenOut on Sepolia`);
      this.totalSuccess++;
      const result: TradeResult = {
        ...base,
        status: 'confirmed',
        txHash: `0xSIMULATED_${Date.now().toString(16)}` as `0x${string}`,
        amountOut: (amountIn * 3000n) / (10n ** 12n),
      };
      return result;
    }

    const tokenIn  = TOKENS.sepolia.WETH;
    const tokenOut = TOKENS.sepolia.USDC;
    const fund = config.fundContractAddress as `0x${string}`;
    const rawKey = config.privateKey as string;
    const hexKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
    const account = privateKeyToAccount(hexKey);
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(sepoliaFailover.getCurrentUrl()),
    });
    const client = getSepoliaClient();
    const vaultOwner = (config.fundOwnerAddress || account.address) as `0x${string}`;

    let drawnDown = false;
    let amountOut = 0n;
    let swapTxHash: `0x${string}` | undefined;
    let swapStatus: TradeStatus | undefined;

    try {
      // 1. Pre-flight checks
      if (fund) {
        console.log(`[executor] Pre-flight: vaultOwner=${vaultOwner}, botExecutor=${account.address}`);
        const botWallet = await client.readContract({ address: fund, abi: FUND_ABI, functionName: 'getBotWallet', args: [vaultOwner] }) as `0x${string}`;
        console.log(`[executor] Pre-flight: contract botWallet=${botWallet}`);
        if (botWallet.toLowerCase() !== account.address.toLowerCase()) {
          throw new Error(`Bot wallet not authorized. Contract expects: ${botWallet}, Executor is: ${account.address}. Set it in the UI Settings tab.`);
        }

        const tradeLimit = await client.readContract({ address: fund, abi: FUND_ABI, functionName: 'getTradeLimit', args: [vaultOwner, tokenIn] }) as bigint;
        if (amountIn > tradeLimit) {
          const limitEth = Number(tradeLimit) / 1e18;
          const wantEth = Number(amountIn) / 1e18;
          throw new Error(`Trade limit too low. Limit: ${limitEth.toFixed(4)} WETH, Trade amount: ${wantEth.toFixed(4)} WETH. Increase it in the UI Settings tab.`);
        }

        const vaultBal = await client.readContract({ address: fund, abi: FUND_ABI, functionName: 'realBalance', args: [vaultOwner, tokenIn] }) as bigint;
        if (vaultBal < amountIn) {
          const balEth = Number(vaultBal) / 1e18;
          const wantEth = Number(amountIn) / 1e18;
          throw new Error(`Insufficient vault balance. Vault has: ${balEth.toFixed(4)} WETH, needs: ${wantEth.toFixed(4)} WETH. Deposit via the UI.`);
        }

        console.log(`[executor] Drawing down ${Number(amountIn) / 1e18} WETH from SwarmFund vault...`);
        const ddTx = await walletClient.writeContract({
          address: fund, abi: FUND_ABI, functionName: 'drawdown', args: [vaultOwner, tokenIn, amountIn]
        });
        await client.waitForTransactionReceipt({ hash: ddTx });
        drawnDown = true;
        console.log(`[executor] Drawdown confirmed`);
      }

      // 2. Swap on Uniswap
      const quote = await getQuote(tokenIn, tokenOut, amountIn, config.poolFee, 'sepolia');
      const amountOutMinimum = applySlippage(quote.amountOut, decision.maxSlippage);

      swapTxHash = await executeSwap(tokenIn, tokenOut, amountIn, amountOutMinimum);
      const receipt = await client.waitForTransactionReceipt({ hash: swapTxHash });
      swapStatus = receipt.status === 'success' ? 'confirmed' : 'failed';

      // 3. Return Funds to SwarmFund
      if (swapStatus === 'confirmed' && fund) {
        amountOut = await client.readContract({
          address: tokenOut, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address]
        }) as bigint;

        console.log(`[executor] Returning ${amountOut} to SwarmFund...`);
        const approveTx = await walletClient.writeContract({
          address: tokenOut, abi: ERC20_ABI, functionName: 'approve', args: [fund, amountOut]
        });
        await client.waitForTransactionReceipt({ hash: approveTx });

        const returnTx = await walletClient.writeContract({
          address: fund, abi: FUND_ABI, functionName: 'returnFunds',
          args: [vaultOwner, tokenOut, amountOut, tokenIn, amountIn],
        });
        await client.waitForTransactionReceipt({ hash: returnTx });
      }

      // CRITICAL: If swap failed but drawdown happened, return the drawn-down WETH
      if (swapStatus === 'failed' && drawnDown && fund) {
        const wethBal = await client.readContract({
          address: tokenIn, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address]
        }) as bigint;
        if (wethBal > 0n) {
          console.log(`[executor] Swap failed -- returning ${wethBal} drawn-down WETH to vault...`);
          const approveTx = await walletClient.writeContract({
            address: tokenIn, abi: ERC20_ABI, functionName: 'approve', args: [fund, wethBal]
          });
          await client.waitForTransactionReceipt({ hash: approveTx });

          const returnTx = await walletClient.writeContract({
            address: fund, abi: FUND_ABI, functionName: 'returnFunds',
            args: [vaultOwner, tokenIn, wethBal, tokenIn, wethBal],
          });
          await client.waitForTransactionReceipt({ hash: returnTx });
          console.log(`[executor] Drawn-down WETH returned to vault`);
        }
      }

      if (swapStatus === 'confirmed') this.totalSuccess++;
      else this.totalFailed++;

      const result: TradeResult = {
        ...base,
        status: swapStatus,
        txHash: swapTxHash,
        amountOut,
        gasUsed: receipt?.gasUsed,
        blockNumber: receipt?.blockNumber ? Number(receipt.blockNumber) : undefined,
      };
      console.log(`[executor] ${swapStatus === 'confirmed' ? '[OK]' : '[X]'} Trade ${swapStatus}: ${swapTxHash}`);
      return result;
    } catch (err) {
      this.totalFailed++;
      const error = err instanceof Error ? err.message : String(err);

      // CRITICAL: If error occurred after drawdown, attempt to return funds
      if (drawnDown && fund) {
        try {
          const wethBal = await client.readContract({
            address: tokenIn, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address]
          }) as bigint;
          const usdcBal = await client.readContract({
            address: tokenOut, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address]
          }) as bigint;

          const returnToken = usdcBal > 0n ? tokenOut : tokenIn;
          const returnAmount = usdcBal > 0n ? usdcBal : wethBal;

          if (returnAmount > 0n) {
            console.log(`[executor] Error after drawdown -- returning ${returnAmount} to vault...`);
            const approveTx = await walletClient.writeContract({
              address: returnToken, abi: ERC20_ABI, functionName: 'approve', args: [fund, returnAmount]
            });
            await client.waitForTransactionReceipt({ hash: approveTx });

            const returnTx = await walletClient.writeContract({
              address: fund, abi: FUND_ABI, functionName: 'returnFunds',
              args: [vaultOwner, returnToken, returnAmount, tokenIn, amountIn],
            });
            await client.waitForTransactionReceipt({ hash: returnTx });
            console.log(`[executor] Funds returned to vault after error`);
          }
        } catch (returnErr) {
          console.error(`[executor] FAILED to return funds after error:`, returnErr);
        }
      }

      console.error(`[executor] Trade failed:`, error);
      return { ...base, status: 'failed', error };
    }
  }

  get stats() {
    return {
      role: this.role,
      ensName: this.ensName,
      uptime: this.uptimeSecs,
      liveMode: this.liveMode,
      walletAddress: this.walletAddress,
      walletBalance: this.walletBalance,
      totalTrades: this.totalTrades,
      totalSuccess: this.totalSuccess,
      totalFailed: this.totalFailed,
      successRate: this.totalTrades
        ? ((this.totalSuccess / this.totalTrades) * 100).toFixed(0) + '%'
        : '--',
      latestResult: this.latestResult,
      tradeHistory: this.tradeHistory,
      fundMetrics: this.fundMetrics,
      lastActionAt: this.lastActionAt,
      lastBlockNumber: this.lastBlockNumber,
      messagesReceived: this.messagesReceived,
      axlConnected: this.axl.isAvailable(),
    };
  }
}
