// Recovery script: drains all ERC-20 tokens from the old SwarmFund contract
// Run: npx tsx scripts/recover-fund.ts

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import 'dotenv/config';

const OLD_FUND = '0xca90a6de17b23339a13658a9f0caf1d4cd88e108' as `0x${string}`;

const TOKENS: Record<string, `0x${string}`> = {
  WETH: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
  USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
};

const FUND_ABI = parseAbi([
  'function withdraw(address token, uint256 amount) external',
  'function owner() view returns (address)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

async function main() {
  const rawKey = process.env.PRIVATE_KEY!;
  if (!rawKey) { console.error('PRIVATE_KEY not set in .env'); process.exit(1); }
  const hexKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(hexKey);

  const publicClient = createPublicClient({ chain: sepolia, transport: http() });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http() });

  console.log(`\nRecovery script — draining: ${OLD_FUND}`);
  console.log(`Caller: ${account.address}\n`);

  // Confirm ownership
  const owner = await publicClient.readContract({ address: OLD_FUND, abi: FUND_ABI, functionName: 'owner' });
  if ((owner as string).toLowerCase() !== account.address.toLowerCase()) {
    console.error(`You are not the owner of this contract. Owner: ${owner}`);
    process.exit(1);
  }

  let anyRecovered = false;

  for (const [symbol, tokenAddr] of Object.entries(TOKENS)) {
    const balance = await publicClient.readContract({
      address: tokenAddr, abi: ERC20_ABI, functionName: 'balanceOf', args: [OLD_FUND],
    }) as bigint;
    const decimals = await publicClient.readContract({
      address: tokenAddr, abi: ERC20_ABI, functionName: 'decimals',
    }) as number;

    const human = Number(balance) / 10 ** decimals;
    console.log(`${symbol}: ${human.toFixed(decimals <= 6 ? 4 : 6)} in old contract`);

    if (balance > 0n) {
      anyRecovered = true;
      console.log(`  → Withdrawing ${human.toFixed(4)} ${symbol}...`);
      const hash = await walletClient.writeContract({
        address: OLD_FUND, abi: FUND_ABI, functionName: 'withdraw', args: [tokenAddr, balance],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✅ Recovered! tx: ${hash}`);
    } else {
      console.log(`  → Nothing to recover.`);
    }
  }

  if (!anyRecovered) {
    console.log('\nOld contract was empty — nothing to recover. Safe to redeploy.\n');
  } else {
    console.log('\nAll funds recovered to your wallet. Safe to redeploy.\n');
  }
}

main().catch(console.error);
