// Uniswap v3 Integration with RPC failover
//
// Prize track: Uniswap Foundation -- Best Uniswap API Integration ($5,000)

import {
  encodeFunctionData, decodeFunctionResult, parseAbi,
  createWalletClient, http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { config, TOKENS, UNISWAP } from '../config/index.js';
import { getMainnetClient, getSepoliaClient, getSepoliaWalletClient, failoverCall, sepoliaFailover } from './viem-client.js';
import type { PriceTick } from '../types/index.js';

const QUOTER_V2_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

const SWAP_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
]);

export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

export async function getQuote(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  fee: number = config.poolFee,
  network: 'mainnet' | 'sepolia' = 'mainnet',
): Promise<PriceTick> {
  const quoter = network === 'mainnet' ? UNISWAP.mainnet.quoterV2 : UNISWAP.sepolia.quoterV2;

  const calldata = encodeFunctionData({
    abi: QUOTER_V2_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
  });

  const { data } = await failoverCall(network, async (client) => {
    return await client.call({ to: quoter, data: calldata });
  });

  if (!data) throw new Error('QuoterV2: empty response');

  const [amountOut] = decodeFunctionResult({
    abi: QUOTER_V2_ABI,
    functionName: 'quoteExactInputSingle',
    data,
  }) as [bigint, bigint, number, bigint];

  const blockNumber = await failoverCall(network, (client) => client.getBlockNumber());

  const inDecimals  = tokenIn  === TOKENS.mainnet.WETH || tokenIn  === TOKENS.sepolia.WETH ? 18 : 6;
  const outDecimals = tokenOut === TOKENS.mainnet.USDC || tokenOut === TOKENS.sepolia.USDC ? 6  : 18;
  const price = (Number(amountOut) / 10 ** outDecimals) / (Number(amountIn) / 10 ** inDecimals);

  return { tokenIn, tokenOut, amountIn, amountOut, price, fee, blockNumber, timestamp: Date.now() };
}

export async function executeSwap(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  amountOutMinimum: bigint,
  fee: number = config.poolFee,
): Promise<`0x${string}`> {
  if (!config.privateKey) throw new Error('PRIVATE_KEY not configured');
  const rawKey = config.privateKey as string;
  const hexKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(hexKey);
  const walletClient = getSepoliaWalletClient(account);
  const router = UNISWAP.sepolia.swapRouter02;

  const sepoliaClient = getSepoliaClient();
  const allowance = await sepoliaClient.readContract({
    address: tokenIn, abi: ERC20_ABI, functionName: 'allowance',
    args: [account.address, router],
  });
  if ((allowance as bigint) < amountIn) {
    console.log(`[Uniswap] Approving router...`);
    const approveTx = await walletClient.writeContract({
      address: tokenIn, abi: ERC20_ABI, functionName: 'approve', args: [router, amountIn * 2n],
    });
    await sepoliaClient.waitForTransactionReceipt({ hash: approveTx });
  }

  const txHash = await walletClient.writeContract({
    address: router, abi: SWAP_ROUTER_ABI, functionName: 'exactInputSingle',
    args: [{ tokenIn, tokenOut, fee, recipient: account.address, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }],
    value: 0n,
  });
  console.log(`[Uniswap] Swap submitted: ${txHash}`);
  return txHash;
}

export function applySlippage(amountOut: bigint, slippagePct: number): bigint {
  return (amountOut * BigInt(Math.floor((1 - slippagePct / 100) * 10000))) / 10000n;
}

export function tokenAddress(symbol: string, network: 'mainnet' | 'sepolia' = 'mainnet'): `0x${string}` {
  const map = network === 'mainnet' ? TOKENS.mainnet : TOKENS.sepolia;
  const addr = (map as Record<string, `0x${string}`>)[symbol.toUpperCase()];
  if (!addr) throw new Error(`Unknown token: ${symbol}`);
  return addr;
}

// Legacy exports for backward compatibility
export { getMainnetClient as mainnetClient, getSepoliaClient as sepoliaClient };
