// ─────────────────────────────────────────────────────────────────────────────
// Gensyn AXL Client -- HTTP bridge to localhost:9002
//
// AXL (Agent eXchange Layer) is Gensyn's P2P encrypted messaging layer.
// When agents are co-located (share one node), messages are routed in-process
// via a shared routing table since true P2P routing requires distinct Peer IDs.
//
// Docs: https://github.com/gensyn-ai/axl
// API:  https://github.com/gensyn-ai/axl/blob/main/docs/api.md
// ─────────────────────────────────────────────────────────────────────────────

import type { AxlMessage, AgentRole } from '../types/index.js';

export interface AxlTopology {
  our_ipv6: string;
  our_public_key: string;
  peers: string[];
  tree: unknown[];
}

type MessageHandler = (msg: AxlMessage) => void;

// Shared in-process routing table for co-located agents sharing one AXL node.
const sharedLocalRoutes: Map<AgentRole, MessageHandler> = new Map();

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
      console.warn(`[AXL] Node not reachable at ${this.baseUrl} -- using local routing`);
      this.available = false;
      return false;
    }
  }

  /** Register another agent's AXL peer ID for remote routing */
  registerPeer(role: AgentRole, peerId: string) {
    this.knownPeers.set(role, peerId);
  }

  /** Register a local handler for co-located agents sharing this AXL node */
  static registerLocalRoute(role: AgentRole, handler: MessageHandler) {
    sharedLocalRoutes.set(role, handler);
  }

  /** Publish a message to another agent */
  async send<T>(to: AgentRole, msg: AxlMessage<T>): Promise<void> {
    // 1. In-process route (co-located agents sharing one AXL node)
    const localHandler = sharedLocalRoutes.get(to);
    if (localHandler) {
      localHandler(msg);
      return;
    }

    // 2. Remote AXL routing via peer ID
    if (this.available) {
      const peerId = this.knownPeers.get(to);
      if (!peerId) {
        console.warn(`[AXL] No peer ID known for ${to}`);
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
        console.warn(`[AXL] Send failed:`, err);
      }
    }
  }

  /** Start polling /recv for inbound messages (AXL mode) */
  startReceiving(handler: MessageHandler) {
    this.handlers.push(handler);
    // Only register if no early route was set up (e.g. in src/index.ts before init)
    if (!sharedLocalRoutes.has(this.role)) {
      sharedLocalRoutes.set(this.role, handler);
    }

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
    }
  }

  getPeerId(): string { return this.peerId; }
  isAvailable(): boolean { return this.available; }

  destroy() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    sharedLocalRoutes.delete(this.role);
  }
}
