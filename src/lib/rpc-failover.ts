// RPC Failover System
//
// Fetches RPC endpoints from chainlist.org, tests them on startup,
// and provides auto-failover during operation.
//
// For each network (mainnet, sepolia), maintains a ranked list of working RPCs.
// If the current RPC fails, automatically rotates to the next one.

import { http, type HttpTransportConfig, type Transport, type Chain } from 'viem';
import { custom, fallback } from 'viem';

interface ChainlistRpc {
  rpc: string[];
  chainId: number;
  name: string;
  shortName: string;
  status?: string;
  explorers?: { url: string }[];
}

interface RpcFailoverConfig {
  chainId: number;
  name: string;
  defaultRpc: string;
}

interface WorkingRpc {
  url: string;
  latency: number;
}

const CHAINLIST_BASE = 'https://chainid.network/chains.json';

class RpcFailoverManager {
  private workingRpcs: WorkingRpc[] = [];
  private currentIndex = 0;
  private config: RpcFailoverConfig;
  private initialized = false;
  private chainlistCache: Map<number, WorkingRpc[]> = new Map();

  constructor(config: RpcFailoverConfig) {
    this.config = config;
  }

  async initialize(forceRefresh = false): Promise<WorkingRpc[]> {
    if (this.initialized && !forceRefresh) return this.workingRpcs;

    if (!forceRefresh && this.chainlistCache.has(this.config.chainId)) {
      this.workingRpcs = this.chainlistCache.get(this.config.chainId)!;
      this.initialized = true;
      return this.workingRpcs;
    }

    const rpcs: string[] = [this.config.defaultRpc];

    try {
      const res = await fetch(CHAINLIST_BASE, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const chains: ChainlistRpc[] = await res.json();
        const chain = chains.find((c) => c.chainId === this.config.chainId);
        if (chain) {
          const extra = chain.rpc
            .filter((r) => !r.includes('${') && !r.includes('${WSS_PASSWORD}'))
            .map((r) => r.replace(/\/+$/, ''));
          rpcs.push(...extra);
        }
      }
    } catch {
      console.warn(`[RPC] chainlist.org unavailable for chain ${this.config.chainId}, using defaults`);
    }

    const knownGood = this.getKnownGood(this.config.chainId);
    rpcs.unshift(...knownGood.filter((r) => !rpcs.includes(r)));

    this.workingRpcs = await this.testRpcs([...new Set(rpcs)]);
    this.chainlistCache.set(this.config.chainId, this.workingRpcs);
    this.initialized = true;

    if (this.workingRpcs.length > 0) {
      console.log(`[RPC] ${this.config.name}: found ${this.workingRpcs.length} working RPCs`);
      this.workingRpcs.forEach((r, i) =>
        console.log(`[RPC]   ${i + 1}. ${r.url} (${r.latency}ms)`)
      );
    } else {
      console.warn(`[RPC] ${this.config.name}: NO working RPCs found!`);
    }

    return this.workingRpcs;
  }

  private getKnownGood(chainId: number): string[] {
    const known = {
      1: [
        'https://eth.llamarpc.com',
        'https://rpc.ankr.com/eth',
        'https://1rpc.io/eth',
        'https://cloudflare-eth.com',
        'https://eth.drpc.org',
        'https://ethereum-rpc.publicnode.com',
      ],
      11155111: [
        'https://ethereum-sepolia-rpc.publicnode.com',
        'https://rpc.ankr.com/eth_sepolia',
        'https://sepolia.drpc.org',
        'https://1rpc.io/sepolia',
        'https://eth-sepolia.g.alchemy.com/v2/demo',
      ],
    };
    return known[chainId as keyof typeof known] || [];
  }

  private async testRpcs(urls: string[]): Promise<WorkingRpc[]> {
    const results: WorkingRpc[] = [];
    const concurrency = 5;

    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const promises = batch.map(async (url) => {
        try {
          const start = Date.now();
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
            signal: AbortSignal.timeout(4000),
          });
          const data = await res.json();
          if (data.result) {
            return { url, latency: Date.now() - start } as WorkingRpc;
          }
        } catch {
          // skip
        }
        return null;
      });

      const batchResults = await Promise.all(promises);
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    return results.sort((a, b) => a.latency - b.latency);
  }

  getCurrentUrl(): string {
    if (this.workingRpcs.length === 0) return this.config.defaultRpc;
    return this.workingRpcs[this.currentIndex % this.workingRpcs.length].url;
  }

  markFailed(): string {
    if (this.workingRpcs.length <= 1) return this.getCurrentUrl();
    this.currentIndex = (this.currentIndex + 1) % this.workingRpcs.length;
    const newUrl = this.getCurrentUrl();
    console.log(`[RPC] ${this.config.name}: rotated to ${newUrl}`);
    return newUrl;
  }

  getUrls(): string[] {
    if (this.workingRpcs.length === 0) return [this.config.defaultRpc];
    return this.workingRpcs.map((r) => r.url);
  }
}

export const mainnetFailover = new RpcFailoverManager({
  chainId: 1,
  name: 'Mainnet',
  defaultRpc: 'https://eth.llamarpc.com',
});

export const sepoliaFailover = new RpcFailoverManager({
  chainId: 11155111,
  name: 'Sepolia',
  defaultRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
});

export async function initRpcFailover(): Promise<void> {
  await Promise.all([
    mainnetFailover.initialize(),
    sepoliaFailover.initialize(),
  ]);
}
