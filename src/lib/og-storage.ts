// 0G Labs Storage Integration
//
// Each agent persists its state snapshots and decision history to the 0G
// decentralized storage network. Creates an immutable audit trail of all
// trading decisions across restarts.
//
// Prize track: 0G Labs -- Best Agent Framework, Tooling & Core Extensions ($7,500)
//              0G Labs -- Best Autonomous Agents, Swarms & iNFT Innovations ($7,500)
//
// SDK: @0glabs/0g-ts-sdk
// Docs: https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk

import { ethers } from 'ethers';
import { config } from '../config/index.js';
import type { AgentStateSnapshot, AgentRole } from '../types/index.js';

let Indexer: any = null;
let ZgFile: any = null;

async function loadSdk() {
  if (Indexer) return;
  try {
    const sdk = await import('@0glabs/0g-ts-sdk');
    Indexer = sdk.Indexer;
    ZgFile = sdk.ZgFile;
  } catch {
    console.warn('[0G] SDK not installed -- state storage disabled. Run: npm install');
  }
}

export class OgStorageClient {
  private indexer: any = null;
  private signer: ethers.Wallet | null = null;
  private role: AgentRole;
  private rootHashLog: Map<string, string> = new Map();

  constructor(role: AgentRole) {
    this.role = role;
  }

  async init(): Promise<void> {
    await loadSdk();
    if (!Indexer) return;

    try {
      const provider = new ethers.JsonRpcProvider(config.ogRpcUrl);

      if (config.privateKey) {
        this.signer = new ethers.Wallet(config.privateKey, provider);
      } else {
        const randomWallet = ethers.Wallet.createRandom();
        this.signer = new ethers.Wallet(randomWallet.privateKey, provider);
        console.warn('[0G] No PRIVATE_KEY -- 0G uploads disabled (read-only mode)');
      }

      this.indexer = new Indexer(config.ogIndexerUrl, this.signer);
      console.log(`[0G] Storage client initialised for ${this.role}`);
    } catch (err) {
      console.warn('[0G] Init failed:', err);
    }
  }

  async storeState(snapshot: AgentStateSnapshot): Promise<string | null> {
    if (!this.indexer || !ZgFile) return null;
    if (!config.privateKey) return null;

    try {
      const json = JSON.stringify(snapshot, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v
      );
      const buffer = Buffer.from(json, 'utf-8');
      const file = await ZgFile.fromBuffer(buffer, `${this.role}-state.json`);

      const [tree, err1] = await file.merkleTree();
      if (err1) throw err1;

      const rootHash: string = tree.rootHash();
      const [, err2] = await this.indexer.upload(file);
      if (err2) throw err2;

      this.rootHashLog.set(`${this.role}:latest`, rootHash);
      console.log(`[0G] State stored for ${this.role} -- root: ${rootHash.slice(0, 16)}...`);
      return rootHash;
    } catch (err) {
      console.warn(`[0G] Store failed for ${this.role}:`, err);
      return null;
    }
  }

  async loadState(rootHash: string): Promise<AgentStateSnapshot | null> {
    if (!this.indexer) return null;

    try {
      const [data, err] = await this.indexer.download(rootHash);
      if (err) throw err;
      const json = Buffer.from(data).toString('utf-8');
      return JSON.parse(json) as AgentStateSnapshot;
    } catch (err) {
      console.warn(`[0G] Load failed (${rootHash.slice(0, 16)}...):`, err);
      return null;
    }
  }

  getLatestRootHash(): string | null {
    return this.rootHashLog.get(`${this.role}:latest`) ?? null;
  }

  async appendEvent(eventType: string, data: unknown): Promise<string | null> {
    if (!this.indexer || !ZgFile) return null;
    if (!config.privateKey) return null;

    try {
      const entry = {
        agent: this.role,
        eventType,
        timestamp: Date.now(),
        data,
      };
      const json = JSON.stringify(entry, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v
      );
      const buffer = Buffer.from(json, 'utf-8');
      const file = await ZgFile.fromBuffer(buffer, `${this.role}-event.json`);
      const [tree, err1] = await file.merkleTree();
      if (err1) throw err1;
      const rootHash: string = tree.rootHash();
      const [, err2] = await this.indexer.upload(file);
      if (err2) throw err2;
      console.log(`[0G] Event logged (${eventType}) -- root: ${rootHash.slice(0, 16)}...`);
      return rootHash;
    } catch (err) {
      console.warn(`[0G] Event log failed:`, err);
      return null;
    }
  }
}
