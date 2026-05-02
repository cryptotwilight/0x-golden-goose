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
  process.stdout.write('\x1B[2J\x1B[H' + getBannerText());
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
// Silence console.log once the dashboard is live so agent logs don't bleed
// into the terminal. All agent output goes to stderr (visible in CI / log files).
function silenceConsole() {
  const orig = console.log.bind(console);
  console.log = (...args: unknown[]) => process.stderr.write(args.join(' ') + '\n');
  console.info = (...args: unknown[]) => process.stderr.write(args.join(' ') + '\n');
  console.warn = (...args: unknown[]) => process.stderr.write(args.join(' ') + '\n');
  return orig; // return original in case caller wants to restore
}

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
    const str = (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
    return n >= 0 ? chalk.red(str) : chalk.green(str);
  };

  const line = (label: string, value: string) =>
    `  ${chalk.gray(label.padEnd(22))} ${value}`;

  const separator = chalk.gray('  ' + '─'.repeat(58));

  const lines = [
    separator,
    chalk.bold('  🔍 PriceScout') + chalk.gray(`  [${axlStatus(s.axlConnected)}]`),
    line('ENS Identity:', chalk.cyan(s.ensName)),
    line('Uptime:', chalk.white(s.uptime + 's')),
    line('Price Ticks:', chalk.white(s.ticks.toString())),
    line('Signals Emitted:', chalk.white(s.totalSignals.toString())),
    line('Latest Price:', chalk.yellow(`$${s.latestPrice.toFixed(2)}`)),
    line('Price Δ:', pct(s.latestChangePct)),
    line('Signal:', dirColor(s.latestDirection)),
    separator,
    chalk.bold('  ⚖️  RiskManager') + chalk.gray(`  [${axlStatus(r.axlConnected)}]`),
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
            : chalk.red(`[X] ${r.latestDecision.reason.slice(0, 40)}`)
        )
      : line('Latest Decision:', chalk.gray('--')),
    separator,
    chalk.bold('  ⚡ Executor') + chalk.gray(`  [${axlStatus(e.axlConnected)}]`),
    line('ENS Identity:', chalk.cyan(e.ensName)),
    line('Mode:', e.liveMode ? chalk.red('LIVE (Sepolia)') : chalk.yellow('SIMULATE')),
    line('Wallet:', e.walletAddress !== '--' ? chalk.gray(e.walletAddress) : chalk.gray('--')),
    line('Balance:', e.liveMode ? chalk.yellow(e.walletBalance) : chalk.gray('n/a')),
    line('Uptime:', chalk.white(e.uptime + 's')),
    line('Total Trades:', chalk.white(e.totalTrades.toString())),
    line('Success / Failed:', `${chalk.green(e.totalSuccess.toString())} / ${chalk.red(e.totalFailed.toString())}`),
    line('Success Rate:', chalk.white(e.successRate)),
    e.latestResult
      ? line('Latest Tx:',
          e.latestResult.status === 'confirmed'
            ? chalk.green(`[OK] ${e.latestResult.txHash?.slice(0, 24)}...`)
            : chalk.red(`[X] ${e.latestResult.error?.slice(0, 35) ?? 'failed'}`)
        )
      : line('Latest Tx:', chalk.gray('--')),
    separator,
    chalk.gray(`  Updated: ${new Date().toLocaleTimeString()}  |  Press Ctrl+C to stop`),
    '',
  ];

  // Full clear + home -- then reprint banner + dashboard atomically
  process.stdout.write(
    '\x1B[2J\x1B[H' +           // clear screen, cursor to top-left
    getBannerText() +            // banner (pre-rendered string, no console.log)
    lines.join('\n') + '\n'
  );
}

function getBannerText(): string {
  return chalk.cyan.bold(`
    ██████╗  ██╗  ██╗    ██████╗   ██████╗  ██╗      ██████╗  ███████╗ ███╗   ██╗
    ██╔══██╗ ╚██╗██╔╝   ██╔════╝  ██╔═══██╗ ██║      ██╔══██╗ ██╔════╝ ████╗  ██║
    ██║  ██║  ╚███╔╝    ██║  ███╗ ██║   ██║ ██║      ██║  ██║ █████╗   ██╔██╗ ██║
    ██║  ██║  ██╔██╗    ██║   ██║ ██║   ██║ ██║      ██║  ██║ ██╔══╝   ██║╚██╗██║
    ╚█████╔╝ ██╔╝ ██╗   ╚██████╔╝ ╚██████╔╝ ███████╗ ██████╔╝ ███████╗ ██║ ╚████║
     ╚════╝  ╚═╝  ╚═╝    ╚═════╝   ╚═════╝  ╚══════╝ ╚═════╝  ╚══════╝ ╚═╝  ╚═══╝
  `) + chalk.yellow.bold(`
    ██████╗   ██████╗   ██████╗  ███████╗ ███████╗
   ██╔════╝  ██╔═══██╗ ██╔═══██╗ ██╔════╝ ██╔════╝
   ██║  ███╗ ██║   ██║ ██║   ██║ ███████╗ █████╗
   ██║   ██║ ██║   ██║ ██║   ██║ ╚════██║ ██╔══╝
   ╚██████╔╝ ╚██████╔╝ ╚██████╔╝ ███████║ ███████╗
    ╚═════╝   ╚═════╝   ╚═════╝  ╚══════╝ ╚══════╝
  `) + chalk.gray('  AI-Powered Multi-Agent DEX Trading Swarm | ETHGlobal OpenAgents\n') +
  chalk.gray(`  Pair: ${chalk.white(config.tokenIn + '/' + config.tokenOut)} | Pool fee: ${chalk.white(config.poolFee / 10000 + '%')} | Poll: ${chalk.white(config.scoutPollMs / 1000 + 's')}\n\n`);
}

// ── KeeperHub HTTP callback server & API ──────────────────────────────────────
function startCallbackServer(scout: PriceScout, risk: RiskManager, executor: Executor): { port: number } {
  const port = 3001;
  const server = createServer(async (req, res) => {
    // Enable CORS for frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/trigger') {
      await scout.onKeeperTrigger();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    } else if (req.method === 'POST' && req.url === '/api/settings') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (typeof data.tickWindowSize === 'number') {
            scout.tickWindowSize = data.tickWindowSize;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, tickWindowSize: scout.tickWindowSize }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid json' }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        scout: scout.stats,
        risk: risk.stats,
        executor: executor.stats,
        timestamp: Date.now()
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => {
    console.log(chalk.gray(`  API/Callback listening on http://localhost:${port}`));
  });
  return { port };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();
  process.stdout.write(chalk.gray('  Initialising agents...\n'));

  const scout    = new PriceScout();
  const risk     = new RiskManager();
  const executor = new Executor();
  const keeper   = new KeeperHubClient();

  // Init all agents (connects AXL, inits 0G storage)
  await Promise.all([scout.init(), risk.init(), executor.init()]);

  // Register KeeperHub workflows (schedule + price alert)
  // Registration runs silently -- errors go to stderr to avoid polluting the dashboard
  const callbackServer = startCallbackServer(scout, risk, executor);
  if (config.keeperHubApiKey) {
    const callbackUrl = `http://localhost:${callbackServer.port}/api/trigger`;
    Promise.all([
      keeper.registerScoutJob(callbackUrl, 1),
      keeper.registerPriceAlert(
        callbackUrl,
        config.tokenIn,
        config.tokenOut,
        config.buyThresholdPct,
      ),
    ]).catch((err) => process.stderr.write(`[KeeperHub] Registration error: ${err}\n`));
  }

  // Start all agents
  await Promise.all([scout.start(), risk.start(), executor.start()]);

  // Redirect all console.log to stderr so they don't corrupt the dashboard
  silenceConsole();

  // Live dashboard -- full clear + redraw every second
  const dashboardTimer = setInterval(() => {
    renderDashboard(scout, risk, executor);
  }, 1000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    clearInterval(dashboardTimer);
    process.stdout.write('\x1B[2J\x1B[H' + chalk.yellow('  Shutting down...\n'));
    await Promise.all([scout.stop(), risk.stop(), executor.stop()]);
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    process.stderr.write(chalk.red('Uncaught exception: ') + String(err) + '\n');
  });
}

main().catch((err) => {
  console.error(chalk.red('Fatal:'), err);
  process.exit(1);
});
