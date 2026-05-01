// ─────────────────────────────────────────────────────────────────────────────
// KeeperHub Integration
//
// KeeperHub is the execution and reliability layer for onchain agents.
// 0x Golden Goose uses KeeperHub to:
//   1. Schedule the PriceScout to poll every N minutes automatically
//   2. Set price-condition triggers (e.g. fire if ETH/USDC deviates >2%)
//   3. Delegate swap execution to managed infrastructure with auto gas estimation
//
// Prize track: KeeperHub -- Best Use of KeeperHub ($4,500)
//
// Docs: https://app.keeperhub.com
// ─────────────────────────────────────────────────────────────────────────────

import { config } from '../config/index.js';

export interface KeeperWorkflow {
  id?: string;
  name: string;
  description: string;
  trigger: KeeperTrigger;
  action: KeeperAction;
  chainId?: number;
  active?: boolean;
}

export interface KeeperTrigger {
  type: 'schedule' | 'price_condition' | 'on_demand';
  // schedule: cron expression
  cron?: string;
  // price_condition: check if price moves beyond threshold
  priceCondition?: {
    tokenA: string;
    tokenB: string;
    deviationPct: number;
    direction: 'up' | 'down' | 'any';
  };
}

export interface KeeperAction {
  type: 'http_callback' | 'contract_call' | 'swap';
  // http_callback: POST to our /api/trigger endpoint
  callbackUrl?: string;
  callbackHeaders?: Record<string, string>;
  callbackBody?: Record<string, unknown>;
  // contract_call: call a contract function
  contractAddress?: string;
  functionSig?: string;
  args?: unknown[];
  // swap: execute a Uniswap swap
  swapParams?: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippagePct: number;
    recipient: string;
  };
}

export class KeeperHubClient {
  private apiUrl: string;
  private apiKey: string;
  private registeredJobs: Map<string, string> = new Map(); // name → id

  constructor() {
    this.apiUrl = config.keeperHubApiUrl;
    this.apiKey = config.keeperHubApiKey;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'X-KeeperHub-Client': '0x-golden-goose/1.0',
    };
  }

  /** Register a scheduled polling job for PriceScout */
  async registerScoutJob(callbackUrl: string, intervalMinutes: number = 1): Promise<string | null> {
    const workflow: KeeperWorkflow = {
      name: '0x-golden-goose-scout-poll',
      description: '0x Golden Goose: Trigger PriceScout to poll Uniswap v3 prices',
      trigger: {
        type: 'schedule',
        cron: `*/${intervalMinutes} * * * *`,
      },
      action: {
        type: 'http_callback',
        callbackUrl,
        callbackHeaders: { 'X-0x-Golden-Goose': 'keeper-trigger' },
        callbackBody: { source: 'keeperhub', event: 'poll_prices' },
      },
      active: true,
    };
    return this.createWorkflow(workflow);
  }

  /** Register a price-condition trigger */
  async registerPriceAlert(
    callbackUrl: string,
    tokenA: string,
    tokenB: string,
    deviationPct: number,
  ): Promise<string | null> {
    const workflow: KeeperWorkflow = {
      name: '0x-golden-goose-price-alert',
      description: `0x Golden Goose: Alert when ${tokenA}/${tokenB} deviates ${deviationPct}%`,
      trigger: {
        type: 'price_condition',
        priceCondition: { tokenA, tokenB, deviationPct, direction: 'any' },
      },
      action: {
        type: 'http_callback',
        callbackUrl,
        callbackHeaders: { 'X-0x-Golden-Goose': 'price-alert' },
        callbackBody: { source: 'keeperhub', event: 'price_alert', tokenA, tokenB, deviationPct },
      },
      active: true,
    };
    return this.createWorkflow(workflow);
  }

  /** Create a workflow on KeeperHub */
  async createWorkflow(workflow: KeeperWorkflow): Promise<string | null> {
    if (!this.apiKey) {
      console.warn('[KeeperHub] No API key -- workflow registration skipped');
      return null;
    }

    try {
      const res = await fetch(`${this.apiUrl}/workflows`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(workflow),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      const created = await res.json() as { id: string; name: string };
      this.registeredJobs.set(workflow.name, created.id);
      console.log(`[KeeperHub] Workflow registered: ${workflow.name} (id: ${created.id})`);
      return created.id;
    } catch (err) {
      console.warn('[KeeperHub] Workflow registration failed:', err);
      return null;
    }
  }

  /** List all registered workflows */
  async listWorkflows(): Promise<KeeperWorkflow[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(`${this.apiUrl}/workflows`, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { workflows: KeeperWorkflow[] };
      return data.workflows ?? [];
    } catch (err) {
      console.warn('[KeeperHub] List workflows failed:', err);
      return [];
    }
  }

  /** Manually trigger a workflow (on-demand) */
  async triggerWorkflow(workflowId: string): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.apiUrl}/workflows/${workflowId}/trigger`, {
        method: 'POST',
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Delete a workflow */
  async deleteWorkflow(workflowId: string): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.apiUrl}/workflows/${workflowId}`, {
        method: 'DELETE',
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  getRegisteredJobId(name: string): string | undefined {
    return this.registeredJobs.get(name);
  }
}
