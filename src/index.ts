// ─────────────────────────────────────────────────────────────────────────────
// 0x Golden Goose -- Entry Point & Live Dashboard
//
// Boots all three agents, wires up KeeperHub, and renders a live terminal
// dashboard showing the swarm status in real time.
//
// Usage:
//   npm run dev              # dev mode (tsx, hot reload)
//   npm start                # production (compiled JS)
//   KEEPER_TRIGGER=1 npm run dev  # simulate a KeeperHub trigger
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import chalk from 'chalk';
import { PriceScout }   from './agents/price-scout.js';
import { RiskManager }  from './agents/risk-manager.js';
import { Executor }     from './agents/executor.js';
import { KeeperHubClient } from './lib/keeperhub.js';
import { createServer } from 'node:http';
import { config } from './config/index.js';

// ── Banner ────────────────────────────────────────────────────────────────────
function printBanner() {
  console.clear();
  console.log(chalk.cyan.bold(`
  ████████╗██████╗  █████╗ ██████╗ ███████╗     ██████╗██╗      █████╗ ██╗    ██╗
     ██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝    ██╔════╝██║     ██╔══██╗██║    ██║
     ██║   ██████╔╝███████║██║  ██║█████╗      ██║     ██║     ███████║██║ █╗ ██║
     ██║   ██╔══██╗██╔══██║██║  ██║██╔══╝      ██║     ██║     ██╔══██║██║███╗██║
     ██║   ██║  ██║██║  ██║██████╔╝███████╗    ╚██████╗███████╗██║  ██║╚███╔███╔╝
     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝    ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
  `));
  console.log(chalk.gray('  AI-Powered Multi-Agent DEX Trading Swarm | ETHGlobal OpenAgents\n'));
  console.log(chalk.gray(`  Pair: ${chalk.white(config.tokenIn + '/' + config.tokenOut)} | Pool fee: ${chalk.white(config.poolFee / 10000 + '%')} | Poll: ${chalk.white(config.scoutPollMs / 1000 + 's')}\n`));
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard(
  scout: PriceScout,
  risk: RiskManager,
  executor: Executor,
) {
  const s = scout.stats;
  const r = risk.stats;
  const e = executor.stats;

  const axlStatus = (ok: boolean) => ok
    ? chalk.green('● AXL')
    : chalk.yellow('● local-bus');

  const dirColor = (d: string) =>
    d === 'BUY' ? chalk.green(d) :
    d === 'SELL' ? chalk.red(d) :
    chalk.gray(d);

  const pct = (n: number) => {
    const s = (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
    return n >= 0 ? chalk.red(s) : chalk.green(s);
  };

  // Move cursor to top (after banner) -- use ANSI codes for live update
  process.stdout.write('\x1B[12;0H');

  const line = (label: string, value: string) =>
    `  ${chalk.gray(label.padEnd(22))} ${value}`;

  const separator = chalk.gray('  ' + '─'.repeat(58));

  const lines = [
    separator,
    chalk.bold('  🔍 PriceScout') + chalk.gray(`  [${axlStatus(s.axlConnected)}]  ${s.ensName}`),
    line('ENS Identity:', chalk.cyan(s.ensName)),
    line('Uptime:', chalk.white(s.uptime + 's')),
    line('Price Ticks:', chalk.white(s.ticks.toString())),
    line('Signals Emitted:', chalk.white(s.totalSignals.toString())),
    line('Latest Price:', chalk.yellow(`$${s.latestPrice.toFixed(2)}`)),
    line('Price Δ:', pct(s.latestChangePct)),
    line('Signal:', dirColor(s.latestDirection)),
    separator,
    chalk.bold('  ⚖️  RiskManager') + chalk.gray(`  [${axlStatus(r.axlConnected)}]  ${r.ensName}`),
    line('ENS Identity:', chalk.cyan(r.ensName)),
    line('Uptime:', chalk.white(r.uptime + 's')),
    line('Decisions:', chalk.white(r.totalDecisions.toString())),
    line('Approved:', chalk.green(r.totalApproved.toString())),
    line('Rejected:', chalk.red(r.totalRejected.toString())),
    line('Approval Rate:', chalk.white(r.approvalRate)),
    r.latestDecision
      ? line('Latest Decision:',
          r.latestDecision.approved
            ? chalk.green(`[OK] APPROVED (risk ${r.latestDecision.riskScore.toFixed(1)})`)
            : chalk.red(`[X] ${r.latestDecision.reason.slice(0, 35)}`)
        )
      : line('Latest Decision:', chalk.gray('--')),
    separator,
    chalk.bold('  ⚡ Executor') + chalk.gray(`  [${axlStatus(e.axlConnected)}]  ${e.ensName}`),
    line('ENS Identity:', chalk.cyan(e.ensName)),
    line('Mode:', e.liveMode ? chalk.red('LIVE (Sepolia)') : chalk.yellow('SIMULATE')),
    line('Uptime:', chalk.white(e.uptime + 's')),
    line('Total Trades:', chalk.white(e.totalTrades.toString())),
    line('Success / Failed:', `${chalk.green(e.totalSuccess.toString())} / ${chalk.red(e.totalFailed.toString())}`),
    line('Success Rate:', chalk.white(e.successRate)),
    e.latestResult
      ? line('Latest Tx:',
          e.latestResult.status === 'confirmed'
            ? chalk.green(`[OK] ${e.latestResult.txHash?.slice(0, 20)}...`)
            : chalk.red(`[X] ${e.latestResult.error?.slice(0, 30) ?? 'failed'}`)
        )
      : line('Latest Tx:', chalk.gray('--')),
    separator,
    chalk.gray(`  Updated: ${new Date().toLocaleTimeString()}  |  Press Ctrl+C to stop`),
    '',
  ];

  process.stdout.write(lines.join('\n') + '\n');
}

// ── KeeperHub HTTP callback server ───────────────────────────────────────────
function startCallbackServer(scout: PriceScout): { port: number } {
  const port = 3001;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/trigger') {
      await scout.onKeeperTrigger();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => {
    console.log(chalk.gray(`  KeeperHub callback listening on http://localhost:${port}/api/trigger`));
  });
  return { port };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  console.log(chalk.gray('  Initialising agents...'));

  const scout    = new PriceScout();
  const risk     = new RiskManager();
  const executor = new Executor();
  const keeper   = new KeeperHubClient();

  // Init all agents (connects AXL, inits 0G storage)
  await Promise.all([scout.init(), risk.init(), executor.init()]);

  // Register KeeperHub workflows (schedule + price alert)
  const callbackServer = startCallbackServer(scout);
  if (config.keeperHubApiKey) {
    const callbackUrl = `http://localhost:${callbackServer.port}/api/trigger`;
    await Promise.all([
      keeper.registerScoutJob(callbackUrl, 1),
      keeper.registerPriceAlert(
        callbackUrl,
        config.tokenIn,
        config.tokenOut,
        config.buyThresholdPct,
      ),
    ]);
  } else {
    console.log(chalk.yellow('  [KeeperHub] No API key -- set KEEPERHUB_API_KEY to register workflows'));
  }

  // Start all agents
  await Promise.all([scout.start(), risk.start(), executor.start()]);

  // Live dashboard -- refresh every 2s
  const dashboardTimer = setInterval(() => {
    renderDashboard(scout, risk, executor);
  }, 2000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n' + chalk.yellow('\n  Shutting down...'));
    clearInterval(dashboardTimer);
    await Promise.all([scout.stop(), risk.stop(), executor.stop()]);
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    console.error(chalk.red('\n  Uncaught exception:'), err);
  });
}

main().catch((err) => {
  console.error(chalk.red('Fatal:'), err);
  process.exit(1);
});
