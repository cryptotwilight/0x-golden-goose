// ─────────────────────────────────────────────────────────────────────────────
// RiskManager Agent
//
// Receives TradeSignals from PriceScout via AXL, applies risk rules, and
// forwards TradeDecisions (approved/rejected) to the Executor.
//
// Risk rules:
//   - Confidence must be ≥ 0.4
//   - Price change must be ≥ threshold and < circuit-breaker (10%)
//   - Cooldown: no two approved trades within 60 seconds
//   - Adjusts trade size based on confidence score
// ─────────────────────────────────────────────────────────────────────────────

import { BaseAgent } from './base-agent.js';
import { config } from '../config/index.js';
import type {
  AxlMessage,
  TradeSignal,
  TradeDecision,
} from '../types/index.js';

const MIN_CONFIDENCE = 0.4;
const CIRCUIT_BREAKER_PCT = 10; // reject if price moved more than 10%
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS ?? 5_000); // default 5s for testing, set to 60000 for prod

export class RiskManager extends BaseAgent {
  private lastApprovedTs: number = 0;
  private totalDecisions: number = 0;
  private totalApproved: number = 0;
  private totalRejected: number = 0;

  // Dashboard stats
  public latestDecision: TradeDecision | null = null;
  public lastActionAt: number = 0;

  constructor() {
    super('risk-manager');
  }

  protected async onInit(): Promise<void> {}
  protected async onStop(): Promise<void> {}

  protected async onStart(): Promise<void> {
    console.log(`[risk-manager] Listening for signals on AXL...`);
  }

  protected async onMessage(msg: AxlMessage): Promise<void> {
    if (msg.type !== 'SIGNAL') return;
    const signal = msg.payload as TradeSignal;
    console.log(`[risk-manager] Signal received: ${signal.direction} id=${signal.id}`);
    const decision = this.evaluate(signal);
    this.latestDecision = decision;
    this.totalDecisions++;
    this.lastActionAt = Date.now();

    if (decision.approved) {
      this.totalApproved++;
      this.lastApprovedTs = Date.now();
      console.log(`[risk-manager] [OK] APPROVED ${signal.direction} -- risk=${decision.riskScore.toFixed(1)}`);
    } else {
      this.totalRejected++;
      console.log(`[risk-manager] [X] REJECTED ${signal.direction} -- ${decision.reason}`);
    }

    // Forward decision to Executor via AXL
    await this.send<TradeDecision>('executor', 'DECISION', decision);

    // Persist to 0G
    await this.persistState({
      totalDecisions: this.totalDecisions,
      recentDecisions: [decision],
    });
    await this.storage.appendEvent('DECISION', decision);
  }

  private evaluate(signal: TradeSignal): TradeDecision {
    const base: Omit<TradeDecision, 'approved' | 'reason' | 'riskScore'> = {
      signalId: signal.id,
      direction: signal.direction,
      price: signal.price,
      maxSlippage: config.maxSlippagePct,
      timestamp: Date.now(),
      riskManagerEns: this.ensName,
    };

    // Rule 1: Confidence gate
    if (signal.confidence < MIN_CONFIDENCE) {
      return { ...base, approved: false, reason: `Low confidence: ${signal.confidence.toFixed(2)} < ${MIN_CONFIDENCE}`, riskScore: 9 };
    }

    // Rule 2: Circuit breaker -- reject extreme moves
    if (Math.abs(signal.priceChangePct) >= CIRCUIT_BREAKER_PCT) {
      return { ...base, approved: false, reason: `Circuit breaker: Δ${signal.priceChangePct.toFixed(1)}% ≥ ${CIRCUIT_BREAKER_PCT}%`, riskScore: 10 };
    }

    // Rule 3: Cooldown
    if (Date.now() - this.lastApprovedTs < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - this.lastApprovedTs)) / 1000);
      return { ...base, approved: false, reason: `Cooldown active -- ${remaining}s remaining`, riskScore: 5 };
    }

    // All rules passed -- compute risk score (lower = safer)
    const riskScore = this.computeRiskScore(signal);

    // Scale trade size by confidence (don't go all-in on low confidence)
    const adjustedAmountIn = BigInt(
      Math.floor(Number(signal.amountIn) * Math.min(1, signal.confidence * 2))
    );

    return {
      ...base,
      approved: true,
      reason: `Risk score ${riskScore.toFixed(1)}/10 -- confidence ${(signal.confidence * 100).toFixed(0)}%`,
      adjustedAmountIn,
      riskScore,
    };
  }

  private computeRiskScore(signal: TradeSignal): number {
    // Higher price deviation = higher risk
    const deviationRisk = Math.min(5, Math.abs(signal.priceChangePct) / 2);
    // Lower confidence = higher risk
    const confidenceRisk = (1 - signal.confidence) * 3;
    // Time since last trade risk (recent = riskier)
    const recencyRisk = Math.max(0, 2 - (Date.now() - this.lastApprovedTs) / 60_000);
    return Math.min(9.9, deviationRisk + confidenceRisk + recencyRisk);
  }

  get stats() {
    return {
      role: this.role,
      ensName: this.ensName,
      uptime: this.uptimeSecs,
      totalDecisions: this.totalDecisions,
      totalApproved: this.totalApproved,
      totalRejected: this.totalRejected,
      approvalRate: this.totalDecisions
        ? ((this.totalApproved / this.totalDecisions) * 100).toFixed(0) + '%'
        : '--',
      latestDecision: this.latestDecision,
      lastActionAt: this.lastActionAt,
      messagesReceived: this.messagesReceived,
      axlConnected: this.axl.isAvailable(),
    };
  }
}
