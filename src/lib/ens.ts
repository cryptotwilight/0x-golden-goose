// ─────────────────────────────────────────────────────────────────────────────
// ENS Integration
//
// Gives each Trade Claw agent a human-readable onchain identity via ENS.
// Agents are identified by names like scout.tradeclaw.eth, and token targets
// can be looked up by ENS name instead of raw address.
//
// Prize track: ENS -- Best ENS Integration for AI Agents ($2,500)
//              ENS -- Most Creative Use of ENS ($2,500)
// ─────────────────────────────────────────────────────────────────────────────

import { createPublicClient, http, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { config } from '../config/index.js';
import type { AgentRole } from '../types/index.js';

const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(config.mainnetRpc),
});

// Cache resolved ENS names to avoid hammering the RPC
const cache = new Map<string, { addr: `0x${string}` | null; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Resolve ENS name → address ────────────────────────────────────────────────
export async function resolveEns(name: string): Promise<`0x${string}` | null> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.addr;

  try {
    const addr = await ensClient.getEnsAddress({ name: normalise(name) });
    cache.set(name, { addr, ts: Date.now() });
    return addr;
  } catch (err) {
    console.warn(`[ENS] Failed to resolve ${name}:`, err);
    cache.set(name, { addr: null, ts: Date.now() });
    return null;
  }
}

// ── Reverse lookup: address → ENS name ───────────────────────────────────────
export async function lookupEns(address: `0x${string}`): Promise<string | null> {
  const key = `reverse:${address.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.addr as string | null;
  }

  try {
    const name = await ensClient.getEnsName({ address: getAddress(address) });
    // reuse cache with name as value
    (cache as Map<string, { addr: string | null; ts: number }>).set(key, {
      addr: name,
      ts: Date.now(),
    });
    return name;
  } catch {
    return null;
  }
}

// ── Agent identity: get ENS name for a role ──────────────────────────────────
export function agentEnsName(role: AgentRole): string {
  switch (role) {
    case 'scout':        return config.ensScoutName;
    case 'risk-manager': return config.ensRiskName;
    case 'executor':     return config.ensExecutorName;
  }
}

// ── Resolve a token by ENS (e.g. "weth.tradeclaw.eth" → address) ─────────────
export async function resolveTokenByEns(nameOrAddress: string): Promise<`0x${string}` | null> {
  if (nameOrAddress.startsWith('0x')) return nameOrAddress as `0x${string}`;
  return resolveEns(nameOrAddress);
}

// ── Avatar: fetch ENS avatar for an agent ────────────────────────────────────
export async function getAgentAvatar(role: AgentRole): Promise<string | null> {
  const name = agentEnsName(role);
  try {
    const avatar = await ensClient.getEnsAvatar({ name: normalise(name) });
    return avatar;
  } catch {
    return null;
  }
}

// ── Normalise ENS name (lowercase, trim) ─────────────────────────────────────
function normalise(name: string): string {
  return name.trim().toLowerCase();
}

// ── Display helper: show ENS name or truncated address ───────────────────────
export function displayIdentity(nameOrAddr: string): string {
  if (nameOrAddr.endsWith('.eth')) return nameOrAddr;
  if (nameOrAddr.startsWith('0x') && nameOrAddr.length === 42) {
    return `${nameOrAddr.slice(0, 6)}...${nameOrAddr.slice(-4)}`;
  }
  return nameOrAddr;
}
