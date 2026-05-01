// ─────────────────────────────────────────────────────────────────────────────
// KeeperHub Setup Script
// Run once to register 0x Golden Goose's automation workflows on KeeperHub.
//
// Usage: npm run setup-keeper
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { KeeperHubClient } from '../src/lib/keeperhub.js';
import { config } from '../src/config/index.js';

const CALLBACK_URL = process.env.CALLBACK_URL ?? 'http://localhost:3001/api/trigger';

async function main() {
  console.log('🔧 Setting up KeeperHub workflows for 0x Golden Goose...\n');

  if (!config.keeperHubApiKey) {
    console.error('[X] KEEPERHUB_API_KEY not set in .env');
    process.exit(1);
  }

  const keeper = new KeeperHubClient();

  console.log(`📡 Callback URL: ${CALLBACK_URL}`);

  // 1. Scheduled polling job (every 1 minute)
  console.log('\n1. Registering scheduled scout poll (every 1 min)...');
  const scheduleId = await keeper.registerScoutJob(CALLBACK_URL, 1);
  if (scheduleId) {
    console.log(`   [OK] Scheduled job: ${scheduleId}`);
  } else {
    console.log('   [X] Failed to register scheduled job');
  }

  // 2. Price condition alert (trigger on ≥ threshold deviation)
  console.log(`\n2. Registering price alert (${config.tokenIn}/${config.tokenOut} ±${config.buyThresholdPct}%)...`);
  const alertId = await keeper.registerPriceAlert(
    CALLBACK_URL,
    config.tokenIn,
    config.tokenOut,
    config.buyThresholdPct,
  );
  if (alertId) {
    console.log(`   [OK] Price alert: ${alertId}`);
  } else {
    console.log('   [X] Failed to register price alert');
  }

  // 3. List all workflows
  console.log('\n3. Current workflows on KeeperHub:');
  const workflows = await keeper.listWorkflows();
  if (workflows.length === 0) {
    console.log('   (none)');
  } else {
    workflows.forEach((w, i) => {
      console.log(`   ${i + 1}. ${w.name} [${w.id}] -- active: ${w.active}`);
    });
  }

  console.log('\n[OK] KeeperHub setup complete!');
  console.log('\nNext steps:');
  console.log('  1. Expose your callback URL publicly (e.g. via ngrok): ngrok http 3001');
  console.log('  2. Update CALLBACK_URL= in your .env');
  console.log('  3. Re-run this script to update the webhook URL');
  console.log('  4. Start 0x Golden Goose: npm run dev');
}

main().catch((err) => {
  console.error('[X] Setup failed:', err);
  process.exit(1);
});
