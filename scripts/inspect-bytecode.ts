import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

async function main() {
  const client = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });
  const address = '0xf40ddca64be8c5d7dc3ee07239209c327b4dd95f';

  const bytecode = await client.getCode({ address: address as `0x${string}` });
  if (!bytecode) { console.log('No bytecode'); return; }

  const bytes = Buffer.from(bytecode.slice(2), 'hex');
  // Find CBOR metadata at end of bytecode
  // Look for 0xa2 0x64 0x69 0x70 0x66 0x58 which is the start of solc metadata
  const metadata = bytecode.slice(-200);
  console.log('Last 200 hex chars:', metadata);

  // Search for compiler version marker
  const solcMarker = '64736f6c63'; // "dsolc" in CBOR
  const solcIdx = bytecode.indexOf(solcMarker);
  if (solcIdx > -1) {
    const solcSection = bytecode.slice(solcIdx);
    console.log('Solc section:', solcSection);
    // The version is encoded after "dsolc" - 3 bytes
    const versionHex = solcSection.slice(solcMarker.length + 2, solcMarker.length + 8);
    const v1 = parseInt(versionHex.slice(0, 2), 16);
    const v2 = parseInt(versionHex.slice(2, 4), 16);
    const v3 = parseInt(versionHex.slice(4, 6), 16);
    console.log(`Compiler version: ${v1}.${v2}.${v3}`);
  }

  // Also check evm version from metadata
  const evmMarker = '65766d56'; // "evmV" in CBOR
  const evmIdx = bytecode.indexOf(evmMarker);
  if (evmIdx > -1) {
    const evmSection = bytecode.slice(evmIdx, evmIdx + 20);
    console.log('EVM section:', evmSection);
  }

  // Check if optimization was used (metadata should contain "optimizer")
  if (bytecode.includes('6f7074696d697a6572')) {
    console.log('Optimization marker found');
  } else {
    console.log('No optimization marker found');
  }

  console.log('\nBytecode length:', bytecode.length);
}

main().catch(console.error);
