import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { config } from '../src/config/index.js';
import solc from 'solc';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    console.log('Compiling SwarmFund.sol...');
    const sourcePath = path.resolve(process.cwd(), 'contracts', 'SwarmFund.sol');
    const source = fs.readFileSync(sourcePath, 'utf8');

    const input = {
        language: 'Solidity',
        sources: {
            'SwarmFund.sol': {
                content: source,
            },
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ['*'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    
    if (output.errors) {
        let hasError = false;
        output.errors.forEach((err: any) => {
            console.error(err.formattedMessage);
            if (err.severity === 'error') hasError = true;
        });
        if (hasError) process.exit(1);
    }

    const contract = output.contracts['SwarmFund.sol']['SwarmFund'];
    const abi = contract.abi;
    const bytecode = ('0x' + contract.evm.bytecode.object) as `0x${string}`;

    console.log('Compiled successfully.');

    // Save ABI for UI and Bot
    const abiPath = path.resolve(process.cwd(), 'src', 'lib', 'SwarmFund.json');
    fs.writeFileSync(abiPath, JSON.stringify(abi, null, 2));
    console.log(`ABI saved to: ${abiPath}`);

    if (!config.privateKey) {
        console.error('PRIVATE_KEY is missing in .env');
        process.exit(1);
    }

    const account = privateKeyToAccount(config.privateKey.startsWith('0x') ? config.privateKey as `0x${string}` : `0x${config.privateKey}`);
    
    const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http()
    });

    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http()
    });

    console.log(`Deploying from account: ${account.address}`);
    
    const hash = await walletClient.deployContract({
        abi,
        bytecode,
        args: [],
    });

    console.log(`Transaction sent. Hash: ${hash}`);
    console.log('Waiting for receipt...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`\n✅ SwarmFund deployed to: ${receipt.contractAddress}`);
    console.log(`\nUpdate your .env:\n  FUND_CONTRACT_ADDRESS=${receipt.contractAddress}\n`);
}

main().catch(console.error);
