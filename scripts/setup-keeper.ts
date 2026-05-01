// ─────────────────────────────────────────────────────────────────────────────
// KeeperHub Setup Script
// Run once to register 0x Golden Goose's automation workflows on KeeperHub.
//
// NOTE: KeeperHub's API key only supports read access (GET /api/workflows).
// Workflow creation must be done manually via https://app.keeperhub.com.
// This script will attempt programmatic registration and fall back to printing
// the exact config you need to paste into the web UI.
//
// Usage: npm run setup-keeper
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { KeeperHubClient } from '../src/lib/keeperhub.js';
import { config } from '../src/config/index.js';

const CALLBACK_URL = process.env.CALLBACK_URL ?? 'http://localhost:3001/api/trigger';

function printManualSetup(callbackUrl: string) {
  console.log('\n──────────────────────────────────────────────────────');
  console.log('  MANUAL SETUP REQUIRED — create these two workflows');
  console.log('  at https://app.keeperhub.com');
  console.log('──────────────────────────────────────────────────────\n');

  console.log('  Workflow 1 — Scheduled Scout Poll');
  console.log('  ┌─────────────────────────────────────────────────┐');
  console.log(`  │  Name:        0x-golden-goose-scout-poll        │`);
  console.log(`  │  Trigger:     Schedule — cron: */1 * * * *      │`);
  console.log(`  │  Action:      HTTP Callback                     │`);
  console.log(`  │  URL:         ${callbackUrl.padEnd(33)} │`);
  console.log(`  │  Method:      POST                              │`);
  console.log(`  │  Body:        {"source":"keeperhub","event":"poll_prices"} │`);
  console.log('  └─────────────────────────────────────────────────┘\n');

  console.log('  Workflow 2 — Price Deviation Alert');
  console.log('  ┌─────────────────────────────────────────────────┐');
  console.log(`  │  Name:        0x-golden-goose-price-alert       │`);
  console.log(`  │  Trigger:     Price Condition                   │`);
  console.log(`  │  Pair:        ${config.tokenIn}/${config.tokenOut.padEnd(38)} │`);
  console.log(`  │  Deviation:   ±${String(config.buyThresholdPct + '%').padEnd(38)} │`);
  console.log(`  │  Direction:   any                               │`);
  console.log(`  │  Action:      HTTP Callback                     │`);
  console.log(`  │  URL:         ${callbackUrl.padEnd(33)} │`);
  console.log(`  │  Body:        {"source":"keeperhub","event":"price_alert"} │`);
  console.log('  └─────────────────────────────────────────────────┘\n');
}

async function main() {
  console.log('🔧 Setting up KeeperHub workflows for 0x Golden Goose...\n');

  if (!config.keeperHubApiKey) {
    console.error('[X] KEEPERHUB_API_KEY not set in .env');
    process.exit(1);
  }

  const keeper = new KeeperHubClient();
  console.log(`📡 Callback URL: ${CALLBACK_URL}`);

  // 1. Attempt programmatic registration
  console.log('\n1. Attempting scheduled scout poll registration...');
  const scheduleId = await keeper.registerScoutJob(CALLBACK_URL, 1);
  if (scheduleId) {
    console.log(`   [OK] Scheduled job registered: ${scheduleId}`);
  } else {
    console.log('   [!] Programmatic registration not available — see manual setup below.');
  }

  console.log(`\n2. Attempting price alert registration (${config.tokenIn}/${config.tokenOut} ±${config.buyThresholdPct}%)...`);
  const alertId = await keeper.registerPriceAlert(
    CALLBACK_URL,
    config.tokenIn,
    config.tokenOut,
    config.buyThresholdPct,
  );
  if (alertId) {
    console.log(`   [OK] Price alert registered: ${alertId}`);
  } else {
    console.log('   [!] Programmatic registration not available — see manual setup below.');
  }

  // 2. List existing workflows
  console.log('\n3. Current workflows on KeeperHub:');
  const workflows = await keeper.listWorkflows();
  if (workflows.length === 0) {
    console.log('   (none yet)');
  } else {
    workflows.forEach((w, i) => {
      console.log(`   ${i + 1}. ${w.name} [${w.id}] -- active: ${w.active}`);
    });
  }

  // If nothing was registered, print manual setup instructions
  if (!scheduleId && !alertId) {
    printManualSetup(CALLBACK_URL);
  }

  console.log('\n[OK] Done. Once workflows are active, start the swarm:');
  console.log('     npm run dev\n');
}

main().catch((err) => {
  console.error('[X] Setup failed:', err);
  process.exit(1);
});
