import { createPublicClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';

async function main() {
  const client = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });

  const FUND_ABI = parseAbi([
    'function getBotWallet(address user) view returns (address)',
    'function getTradeLimit(address user, address token) view returns (uint256)',
    'function realBalance(address user, address token) view returns (uint256)',
  ]);

  const FUND = '0xf40ddca64be8c5d7dc3ee07239209c327b4dd95f';
  const OWNER = '0x310550d7Be4A22545f05a6D48e285Eb17765570e';
  const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
  const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

  const bot = await client.readContract({ address: FUND, abi: FUND_ABI, functionName: 'getBotWallet', args: [OWNER] });
  console.log('botWallet:', bot);

  const limitWeth = await client.readContract({ address: FUND, abi: FUND_ABI, functionName: 'getTradeLimit', args: [OWNER, WETH] });
  console.log('tradeLimit WETH:', limitWeth.toString());

  const limitUsdc = await client.readContract({ address: FUND, abi: FUND_ABI, functionName: 'getTradeLimit', args: [OWNER, USDC] });
  console.log('tradeLimit USDC:', limitUsdc.toString());

  const balWeth = await client.readContract({ address: FUND, abi: FUND_ABI, functionName: 'realBalance', args: [OWNER, WETH] });
  console.log('realBalance WETH:', balWeth.toString());

  const balUsdc = await client.readContract({ address: FUND, abi: FUND_ABI, functionName: 'realBalance', args: [OWNER, USDC] });
  console.log('realBalance USDC:', balUsdc.toString());
}

main().catch(console.error);
