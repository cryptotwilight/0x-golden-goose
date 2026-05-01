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
import { executeSwap, applySlippage, tokenAddress } from '../lib/uniswap.js';
import { sepoliaClient } from '../lib/uniswap.js';
import { config, TOKENS } from '../config/index.js';
import type {
  AxlMessage,
  TradeDecision,
  TradeResult,
  TradeStatus,
} from '../types/index.js';

export class Executor extends BaseAgent {
  private pendingDecision: TradeDecision | null = null;
  private totalTrades: number = 0;
  private totalSuccess: number = 0;
  private totalFailed: number = 0;
  private liveMode: boolean = false;

  // Dashboard
  public latestResult: TradeResult | null = null;
  public tradeHistory: TradeResult[] = [];

  constructor() {
    super('executor');
  }

  protected async onInit(): Promise<void> {
    this.liveMode = !!config.privateKey;
    if (this.liveMode) {
      console.log(`[executor] Live mode -- will submit swaps on Sepolia`);
    } else {
      console.log(`[executor] Simulate mode -- no PRIVATE_KEY set`);
    }
  }

  protected async onStart(): Promise<void> {
    console.log(`[executor] Waiting for approved decisions from RiskManager...`);
  }

  protected async onStop(): Promise<void> {}

  protected async onMessage(msg: AxlMessage): Promise<void> {
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
    this.tradeHistory.push(result);
    if (this.tradeHistory.length > 50) this.tradeHistory.shift();

    // Persist to 0G
    await this.persistState({
      totalTrades: this.totalTrades,
      recentResults: [result],
    });
    await this.storage.appendEvent('RESULT', result);

    // Broadcast result back (could be picked up by a monitor/dashboard agent)
    await this.send('scout', 'RESULT', result);
  }

  private async executeTrade(decision: TradeDecision): Promise<TradeResult> {
    this.totalTrades++;
    const amountIn = decision.adjustedAmountIn ?? config.tradeAmountWei;
    const base: Omit<TradeResult, 'status' | 'txHash' | 'amountOut' | 'gasUsed' | 'error'> = {
      signalId: decision.signalId,
      amountIn,
      timestamp: Date.now(),
      executorEns: this.ensName,
    };

    if (!this.liveMode) {
      // Simulate: log the swap params without submitting
      console.log(`[executor] [SIMULATE] Would swap ${amountIn} tokenIn → tokenOut on Sepolia`);
      console.log(`[executor] [SIMULATE] Max slippage: ${decision.maxSlippage}%`);
      this.totalSuccess++;
      const result: TradeResult = {
        ...base,
        status: 'confirmed',
        txHash: `0xSIMULATED_${Date.now().toString(16)}` as `0x${string}`,
        amountOut: (amountIn * 3000n) / (10n ** 12n), // fake USDC amount
      };
      console.log(`[executor] [SIMULATE] [OK] Simulated tx: ${result.txHash}`);
      return result;
    }

    // Live mode: execute on Sepolia
    try {
      // Use Sepolia token addresses
      const tokenIn  = TOKENS.sepolia.WETH;
      const tokenOut = TOKENS.sepolia.USDC;

      // Get a fresh quote on Sepolia for minimum output calculation
      const { getQuote } = await import('../lib/uniswap.js');
      const quote = await getQuote(tokenIn, tokenOut, amountIn, config.poolFee, 'sepolia');
      const amountOutMinimum = applySlippage(quote.amountOut, decision.maxSlippage);

      const txHash = await executeSwap(tokenIn, tokenOut, amountIn, amountOutMinimum);

      // Wait for confirmation
      const receipt = await sepoliaClient.waitForTransactionReceipt({ hash: txHash });
      const status: TradeStatus = receipt.status === 'success' ? 'confirmed' : 'failed';

      if (status === 'confirmed') this.totalSuccess++;
      else this.totalFailed++;

      const result: TradeResult = {
        ...base,
        status,
        txHash,
        gasUsed: receipt.gasUsed,
      };
      console.log(`[executor] ${status === 'confirmed' ? '[OK]' : '[X]'} Trade ${status}: ${txHash}`);
      return result;
    } catch (err) {
      this.totalFailed++;
      const error = err instanceof Error ? err.message : String(err);
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
      totalTrades: this.totalTrades,
      totalSuccess: this.totalSuccess,
      totalFailed: this.totalFailed,
      successRate: this.totalTrades
        ? ((this.totalSuccess / this.totalTrades) * 100).toFixed(0) + '%'
        : '--',
      latestResult: this.latestResult,
      messagesReceived: this.messagesReceived,
      axlConnected: this.axl.isAvailable(),
    };
  }
}
