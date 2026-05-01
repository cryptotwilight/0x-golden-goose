// ─────────────────────────────────────────────────────────────────────────────
// Gensyn AXL Client -- HTTP bridge to localhost:9002
//
// AXL (Agent eXchange Layer) is Gensyn's P2P encrypted messaging layer.
// Each agent runs as an AXL node; they exchange messages via /send and /recv.
// When AXL is not available, falls back to a local EventEmitter for dev mode.
//
// Docs: https://github.com/gensyn-ai/axl
// API:  https://github.com/gensyn-ai/axl/blob/main/docs/api.md
// ─────────────────────────────────────────────────────────────────────────────

import { EventEmitter } from 'events';
import type { AxlMessage, AgentRole } from '../types/index.js';

export interface AxlTopology {
  our_ipv6: string;
  our_public_key: string;
  peers: string[];
  tree: unknown[];
}

type MessageHandler = (msg: AxlMessage) => void;

// Global fallback bus for when AXL node is not running
const localBus = new EventEmitter();
localBus.setMaxListeners(20);

export class AxlClient {
  private baseUrl: string;
  private role: AgentRole;
  private available: boolean = false;
  private peerId: string = '';
  private knownPeers: Map<AgentRole, string> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private handlers: MessageHandler[] = [];

  constructor(baseUrl: string, role: AgentRole) {
    this.baseUrl = baseUrl;
    this.role = role;
  }

  /** Connect to the AXL node and discover our peer ID */
  async connect(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/topology`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const topo: AxlTopology = await res.json();
      this.peerId = topo.our_public_key;
      this.available = true;
      console.log(`[AXL] ${this.role} connected -- peer_id: ${this.peerId.slice(0, 16)}...`);
      return true;
    } catch {
      console.warn(`[AXL] Node not reachable at ${this.baseUrl} -- using local bus fallback`);
      this.available = false;
      return false;
    }
  }

  /** Register this agent's peer ID with others (used in AXL mode) */
  registerPeer(role: AgentRole, peerId: string) {
    this.knownPeers.set(role, peerId);
  }

  /** Publish a message to another agent */
  async send<T>(to: AgentRole, msg: AxlMessage<T>): Promise<void> {
    if (this.available) {
      const peerId = this.knownPeers.get(to);
      if (!peerId) {
        console.warn(`[AXL] No peer ID known for ${to}, falling back to local bus`);
        localBus.emit(`msg:${to}`, msg);
        return;
      }
      try {
        const body = JSON.stringify(msg);
        const res = await fetch(`${this.baseUrl}/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Destination-Peer-Id': peerId,
          },
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`AXL send failed: ${res.status}`);
        const sentBytes = res.headers.get('X-Sent-Bytes');
        console.log(`[AXL] Sent ${sentBytes}B to ${to} (${msg.type})`);
        return;
      } catch (err) {
        console.warn(`[AXL] Send failed, using local bus:`, err);
      }
    }
    // Local fallback
    localBus.emit(`msg:${to}`, msg);
  }

  /** Start polling /recv for inbound messages (AXL mode) */
  startReceiving(handler: MessageHandler) {
    this.handlers.push(handler);

    if (this.available) {
      this.pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`${this.baseUrl}/recv`, { signal: AbortSignal.timeout(3000) });
          if (res.status === 204) return; // empty queue
          if (!res.ok) return;
          const raw = await res.text();
          const from = res.headers.get('X-From-Peer-Id') ?? 'unknown';
          try {
            const msg: AxlMessage = JSON.parse(raw);
            this.handlers.forEach((h) => h(msg));
          } catch {
            console.warn(`[AXL] Unparseable message from ${from.slice(0, 16)}`);
          }
        } catch { /* timeout or unavailable */ }
      }, 500);
    } else {
      // Local fallback: listen on EventEmitter
      localBus.on(`msg:${this.role}`, (msg: AxlMessage) => {
        this.handlers.forEach((h) => h(msg));
      });
    }
  }

  getPeerId(): string { return this.peerId; }
  isAvailable(): boolean { return this.available; }

  destroy() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    localBus.removeAllListeners(`msg:${this.role}`);
  }
}
