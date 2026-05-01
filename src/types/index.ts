// ─────────────────────────────────────────────────────────────────────────────
// Trade Claw -- Shared Types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentRole = 'scout' | 'risk-manager' | 'executor';

export type SignalDirection = 'BUY' | 'SELL' | 'HOLD';

export type TradeStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'submitted'
  | 'confirmed'
  | 'failed';

// ── Price tick from Uniswap ───────────────────────────────────────────────────
export interface PriceTick {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  price: number; // tokenOut per tokenIn (human-readable)
  fee: number;
  blockNumber: bigint;
  timestamp: number;
}

// ── Signal emitted by PriceScout ─────────────────────────────────────────────
export interface TradeSignal {
  id: string;
  direction: SignalDirection;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  expectedOut: bigint;
  price: number;
  priceChangePct: number;
  confidence: number; // 0–1
  timestamp: number;
  scoutEns?: string;
}

// ── Decision from RiskManager ─────────────────────────────────────────────────
export interface TradeDecision {
  signalId: string;
  approved: boolean;
  reason: string;
  adjustedAmountIn?: bigint;
  maxSlippage: number;
  riskScore: number; // 0–10, lower is safer
  timestamp: number;
  riskManagerEns?: string;
}

// ── Execution result from Executor ───────────────────────────────────────────
export interface TradeResult {
  signalId: string;
  status: TradeStatus;
  txHash?: `0x${string}`;
  amountIn: bigint;
  amountOut?: bigint;
  gasUsed?: bigint;
  error?: string;
  timestamp: number;
  executorEns?: string;
}

// ── AXL message envelope ─────────────────────────────────────────────────────
export interface AxlMessage<T = unknown> {
  type: 'SIGNAL' | 'DECISION' | 'RESULT' | 'HEARTBEAT';
  from: AgentRole;
  to: AgentRole;
  payload: T;
  messageId: string;
  timestamp: number;
}

// ── 0G agent state snapshot ───────────────────────────────────────────────────
export interface AgentStateSnapshot {
  agentRole: AgentRole;
  agentEns?: string;
  lastSeen: number;
  totalSignals?: number;
  totalDecisions?: number;
  totalTrades?: number;
  recentPriceTicks?: PriceTick[];
  recentSignals?: TradeSignal[];
  recentDecisions?: TradeDecision[];
  recentResults?: TradeResult[];
}
