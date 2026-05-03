import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function tryVerify() {
  const source = readFileSync(resolve(__dirname, '..', 'contracts', 'SwarmFund.sol'), 'utf-8');
  const apiKey = process.env.ETHERSCAN_API_KEY || 'HQMRPQYQQA59T2PQVQURSA4XSC44BS3J1F';
  const contractAddress = '0xf40ddca64be8c5d7dc3ee07239209c327b4dd95f';

  // V2 API requires JSON-encoded source code
  const jsonSource = JSON.stringify({
    language: 'Solidity',
    settings: {
      optimizer: { enabled: false, runs: 200 },
      outputSelection: { '*': { '': ['*'], '*': ['abi', 'metadata', 'evm.bytecode.object', 'evm.bytecode.sourceMap'] } },
    },
    sources: {
      'SwarmFund.sol': { content: source },
    },
  });

  const params = new URLSearchParams();
  params.append('module', 'contract');
  params.append('action', 'verifysourcecode');
  params.append('contractaddress', contractAddress);
  params.append('sourceCode', jsonSource);
  params.append('codeformat', 'solidity-standard-json-input');
  params.append('contractName', 'SwarmFund.sol:SwarmFund');
  params.append('compilerversion', 'v0.8.20+commit.a1b79de6');
  params.append('constructorArguments', '');
  params.append('evmversion', 'london');

  const url = `https://api.etherscan.io/v2/api?chainid=11155111&apikey=${apiKey}`;

  console.log('Submitting with JSON input format...');
  console.log('Source JSON length:', jsonSource.length);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await res.text();
  console.log('Response:', text);

  try {
    const data = JSON.parse(text);
    if (data.result?.includes('Pending') || data.result?.startsWith('Success') || data.result?.startsWith('OK')) {
      console.log('\n✅ Submitted! GUID:', data.result);
      await checkStatus(data.result, apiKey);
    } else {
      console.log('\n❌ Error:', data.result);
    }
  } catch {
    console.log('Non-JSON:', text);
  }
}

async function checkStatus(guid: string, apiKey: string) {
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const url = `https://api.etherscan.io/v2/api?chainid=11155111&module=contract&action=checkverifystatus&guid=${guid}&apikey=${apiKey}`;
    const res = await fetch(url);
    const text = await res.text();
    console.log(`  [${i + 1}] ${text.substring(0, 300)}`);
    try {
      const data = JSON.parse(text);
      if (data.result === 'Pass - Verified') {
        console.log('\n✅ Contract verified!');
        console.log(`   https://sepolia.etherscan.io/address/0xf40ddca64be8c5d7dc3ee07239209c327b4dd95f#code`);
        return;
      }
      if (data.result?.startsWith('Fail')) {
        console.log('\n❌ Failed:', data.result);
        return;
      }
    } catch {}
  }
  console.log('\nCheck: https://sepolia.etherscan.io/address/0xf40ddca64be8c5d7dc3ee07239209c327b4dd95f#code');
}

tryVerify().catch(console.error);
