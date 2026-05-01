// ─────────────────────────────────────────────────────────────────────────────
// Base Agent
//
// All 0x Golden Goose agents extend BaseAgent. Provides:
//   - AXL message bus (Gensyn)
//   - 0G state persistence
//   - ENS identity
//   - Lifecycle: init → start → stop
// ─────────────────────────────────────────────────────────────────────────────

import { AxlClient } from '../lib/axl-client.js';
import { OgStorageClient } from '../lib/og-storage.js';
import { agentEnsName } from '../lib/ens.js';
import { config } from '../config/index.js';
import type { AgentRole, AxlMessage, AgentStateSnapshot } from '../types/index.js';

export abstract class BaseAgent {
  protected role: AgentRole;
  protected ensName: string;
  protected axl: AxlClient;
  protected storage: OgStorageClient;
  protected running: boolean = false;

  // Stats
  protected startedAt: number = 0;
  protected messagesSent: number = 0;
  protected messagesReceived: number = 0;

  constructor(role: AgentRole) {
    this.role = role;
    this.ensName = agentEnsName(role);
    this.axl = new AxlClient(config.axlApiUrl, role);
    this.storage = new OgStorageClient(role);
  }

  /** Called once before start() -- connect services */
  async init(): Promise<void> {
    await this.axl.connect();
    await this.storage.init();
    await this.onInit();
    console.log(`[${this.role}] Initialised as ${this.ensName}`);
  }

  /** Start the agent loop */
  async start(): Promise<void> {
    this.running = true;
    this.startedAt = Date.now();

    // Subscribe to inbound AXL messages
    this.axl.startReceiving((msg) => {
      this.messagesReceived++;
      this.onMessage(msg).catch((err) =>
        console.error(`[${this.role}] onMessage error:`, err)
      );
    });

    console.log(`[${this.role}] Started ✓`);
    await this.onStart();
  }

  /** Stop the agent loop */
  async stop(): Promise<void> {
    this.running = false;
    this.axl.destroy();
    await this.onStop();
    console.log(`[${this.role}] Stopped`);
  }

  /** Send a message to another agent via AXL */
  protected async send<T>(to: AgentRole, type: AxlMessage['type'], payload: T): Promise<void> {
    const msg: AxlMessage<T> = {
      type,
      from: this.role,
      to,
      payload,
      messageId: `${this.role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };
    await this.axl.send(to, msg);
    this.messagesSent++;
  }

  /** Persist current state snapshot to 0G storage */
  protected async persistState(extra: Partial<AgentStateSnapshot> = {}): Promise<void> {
    const snapshot: AgentStateSnapshot = {
      agentRole: this.role,
      agentEns: this.ensName,
      lastSeen: Date.now(),
      ...extra,
    };
    await this.storage.storeState(snapshot);
  }

  /** Get uptime in seconds */
  get uptimeSecs(): number {
    return this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  }

  // ── Abstract hooks ─────────────────────────────────────────────────────────
  protected abstract onInit(): Promise<void>;
  protected abstract onStart(): Promise<void>;
  protected abstract onStop(): Promise<void>;
  protected abstract onMessage(msg: AxlMessage): Promise<void>;
}
