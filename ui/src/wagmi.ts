import { createConfig, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { injected } from '@wagmi/connectors';

export const SWARM_FUND_ADDRESS = '0xf40ddca64be8c5d7dc3ee07239209c327b4dd95f' as const;

export const SEPOLIA_TOKENS = {
  WETH: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' as const,
  USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const,
};

export const FUND_ABI = [
  { name: 'deposit',       type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'withdraw',      type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'setBotWallet',  type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bot',   type: 'address' }], outputs: [] },
  { name: 'setTradeLimit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'limit', type: 'uint256' }], outputs: [] },
  { name: 'realBalance',       type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }, { name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'notionalBalance',   type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }, { name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'inflightFunds',     type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }, { name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'harvestableAmount', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }, { name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'getTradeLimit',     type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }, { name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'getBotWallet',      type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'address' }] },
] as const;

export const ERC20_ABI = [
  { name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',       inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',       inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: { [sepolia.id]: http() },
});
