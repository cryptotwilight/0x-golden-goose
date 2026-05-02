// ─────────────────────────────────────────────────────────────────────────────
// PriceScout Agent
//
// Monitors the Uniswap v3 WETH/USDC pool on mainnet in real-time.
// Detects price deviations and emits TradeSignals to the RiskManager via AXL.
// Stores price history to 0G for persistent memory.
//
// Trigger: KeeperHub schedule (every minute) OR internal poll loop
// ─────────────────────────────────────────────────────────────────────────────

import { BaseAgent } from './base-agent.js';
import { getQuote, tokenAddress } from '../lib/uniswap.js';
import { config, TOKENS } from '../config/index.js';
import type { AxlMessage, PriceTick, TradeSignal, SignalDirection } from '../types/index.js';

export class PriceScout extends BaseAgent {
  private priceTicks: PriceTick[] = [];
  private lastSignalTs: number = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private totalSignals: number = 0;

  // Public stat for the dashboard
  public latestPrice: number = 0;
  public latestChangePct: number = 0;
  public latestDirection: SignalDirection = 'HOLD';
  public tickWindowSize: number = 5;
  public buyThresholdPct: number = config.buyThresholdPct;
  public sellThresholdPct: number = config.sellThresholdPct;
  public lastActionAt: number = 0;
  public lastBlockNumber: number = 0;

  constructor() {
    super('scout');
  }

  protected async onInit(): Promise<void> {
    // Warm up: fetch first tick to establish baseline
    await this.fetchAndProcess();
  }

  protected async onStart(): Promise<void> {
    // Poll on a regular interval (KeeperHub also triggers this via HTTP)
    this.pollTimer = setInterval(async () => {
      if (!this.running) return;
      await this.fetchAndProcess();
    }, config.scoutPollMs);
  }

  protected async onStop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  protected async onMessage(msg: AxlMessage): Promise<void> {
    // Scout can receive heartbeat pings from KeeperHub (HTTP callback → AXL)
    if (msg.type === 'HEARTBEAT') {
      console.log(`[scout] Heartbeat received from ${msg.from}`);
      await this.fetchAndProcess();
    }
  }

  /** Called by KeeperHub HTTP callback endpoint */
  async onKeeperTrigger(): Promise<void> {
    await this.fetchAndProcess();
  }

  // ── Core logic ─────────────────────────────────────────────────────────────
  private async fetchAndProcess(): Promise<void> {
    try {
      const tokenIn  = TOKENS.mainnet.WETH;
      const tokenOut = TOKENS.mainnet.USDC;
      const amountIn = config.tradeAmountWei;

      const tick = await getQuote(tokenIn, tokenOut, amountIn, config.poolFee, 'mainnet');
      this.priceTicks.push(tick);

      // Keep last 100 ticks in memory
      if (this.priceTicks.length > 100) this.priceTicks.shift();

      this.latestPrice = tick.price;
      this.lastActionAt = Date.now();
      this.lastBlockNumber = tick.blockNumber != null ? Number(tick.blockNumber) : 0;
      console.log(`[scout] ${config.tokenIn}/${config.tokenOut} = $${tick.price.toFixed(2)} (block ${tick.blockNumber})`);

      // Detect signal
      const signal = this.evaluateSignal(tick);
      if (signal) {
        this.totalSignals++;
        this.latestDirection = signal.direction;
        this.latestChangePct = signal.priceChangePct;
        console.log(`[scout] 🚨 Signal: ${signal.direction} @ $${tick.price.toFixed(2)} (Δ${signal.priceChangePct.toFixed(2)}%) id=${signal.id}`);

        // Forward to RiskManager via AXL
        await this.send<TradeSignal>('risk-manager', 'SIGNAL', signal);

        // Persist to 0G
        await this.persistState({
          totalSignals: this.totalSignals,
          recentPriceTicks: this.priceTicks.slice(-10),
          recentSignals: [signal],
        });
        await this.storage.appendEvent('SIGNAL', signal);

        this.lastSignalTs = Date.now();
      }
    } catch (err) {
      console.error('[scout] fetchAndProcess error:', err);
    }
  }

  private evaluateSignal(tick: PriceTick): TradeSignal | null {
    if (this.priceTicks.length < 3) return null;

    // Use a configurable tick window rolling average as baseline
    const windowSize = Math.min(this.tickWindowSize + 1, this.priceTicks.length);
    const window = this.priceTicks.slice(-windowSize, -1);
    if (window.length < 2) return null;
    const avgPrice = window.reduce((sum, t) => sum + t.price, 0) / window.length;

    const changePct = ((tick.price - avgPrice) / avgPrice) * 100;
    this.latestChangePct = changePct;

    let direction: SignalDirection = 'HOLD';
    let confidence = 0;

    if (changePct <= -this.buyThresholdPct) {
      direction = 'BUY';
      confidence = Math.min(1, Math.abs(changePct) / (this.buyThresholdPct * 3));
    } else if (changePct >= this.sellThresholdPct) {
      direction = 'SELL';
      confidence = Math.min(1, changePct / (this.sellThresholdPct * 3));
    } else {
      this.latestDirection = 'HOLD';
      return null;
    }

    // Throttle: at most one signal per 2× poll interval
    if (Date.now() - this.lastSignalTs < config.scoutPollMs * 2) return null;

    return {
      id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      direction,
      tokenIn:    direction === 'BUY' ? tick.tokenOut : tick.tokenIn,
      tokenOut:   direction === 'BUY' ? tick.tokenIn  : tick.tokenOut,
      amountIn:   config.tradeAmountWei,
      expectedOut: tick.amountOut,
      price:      tick.price,
      priceChangePct: changePct,
      confidence,
      timestamp:  tick.timestamp,
      scoutEns:   this.ensName,
    };
  }

  // ── Dashboard stats ────────────────────────────────────────────────────────
  get stats() {
    return {
      role: this.role,
      ensName: this.ensName,
      uptime: this.uptimeSecs,
      ticks: this.priceTicks.length,
      totalSignals: this.totalSignals,
      recentPrices: this.priceTicks.slice(-60).map((t) => ({ price: t.price, timestamp: t.timestamp })),
      buyThresholdPct: this.buyThresholdPct,
      sellThresholdPct: this.sellThresholdPct,
      scoutPollMs: config.scoutPollMs,
      latestPrice: this.latestPrice,
      latestChangePct: this.latestChangePct,
      latestDirection: this.latestDirection,
      tickWindowSize: this.tickWindowSize,
      lastActionAt: this.lastActionAt,
      lastBlockNumber: this.lastBlockNumber,
      messagesSent: this.messagesSent,
      axlConnected: this.axl.isAvailable(),
    };
  }
}
