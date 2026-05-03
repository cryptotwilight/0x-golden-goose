// Failover-aware viem client wrapper
//
// Wraps viem's createPublicClient with automatic RPC failover.
// When an RPC call fails, it rotates to the next working RPC and retries.

import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Transport } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { mainnetFailover, sepoliaFailover } from './rpc-failover.js';

// Singleton clients -- recreated on failover
let _mainnetClient: PublicClient | null = null;
let _sepoliaClient: PublicClient | null = null;

function createMainnetClient(): PublicClient {
  return createPublicClient({
    chain: {
      id: 1,
      name: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [mainnetFailover.getCurrentUrl()] },
        public: { http: [mainnetFailover.getCurrentUrl()] },
      },
    },
    transport: http(mainnetFailover.getCurrentUrl()),
  });
}

function createSepoliaClient(): PublicClient {
  return createPublicClient({
    chain: {
      id: 11155111,
      name: 'Sepolia',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [sepoliaFailover.getCurrentUrl()] },
        public: { http: [sepoliaFailover.getCurrentUrl()] },
      },
    },
    transport: http(sepoliaFailover.getCurrentUrl()),
  });
}

export function getMainnetClient(): PublicClient {
  if (!_mainnetClient) _mainnetClient = createMainnetClient();
  return _mainnetClient;
}

export function getSepoliaClient(): PublicClient {
  if (!_sepoliaClient) _sepoliaClient = createSepoliaClient();
  return _sepoliaClient;
}

export function getSepoliaWalletClient(account: any) {
  return createWalletClient({
    account,
    chain: sepolia,
    transport: http(sepoliaFailover.getCurrentUrl()),
  }) as WalletClient<typeof sepolia, typeof sepoliaFailover, typeof account>;
}

export async function failoverCall<T>(network: 'mainnet' | 'sepolia', fn: (client: PublicClient) => Promise<T>, maxRetries = 3): Promise<T> {
  const failover = network === 'mainnet' ? mainnetFailover : sepoliaFailover;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const client = network === 'mainnet' ? getMainnetClient() : getSepoliaClient();
      return await fn(client);
    } catch (err: any) {
      const isRpcError = err?.message?.includes('429') ||
        err?.message?.includes('rate limit') ||
        err?.message?.includes('Requested resource not found') ||
        err?.message?.includes('502') ||
        err?.message?.includes('503') ||
        err?.message?.includes('504') ||
        err?.message?.includes('timeout') ||
        err?.message?.includes('ECONNREFUSED') ||
        err?.message?.includes('ETIMEDOUT');

      if (isRpcError && attempt < maxRetries - 1) {
        const newUrl = failover.markFailed();
        // Recreate the client with the new URL
        if (network === 'mainnet') {
          _mainnetClient = createMainnetClient();
        } else {
          _sepoliaClient = createSepoliaClient();
        }
        console.log(`[RPC] ${network} attempt ${attempt + 2} with ${newUrl}`);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`All ${maxRetries} RPC attempts failed for ${network}`);
}

// Re-export failover manager for initialization
export { mainnetFailover, sepoliaFailover, initRpcFailover } from './rpc-failover.js';
