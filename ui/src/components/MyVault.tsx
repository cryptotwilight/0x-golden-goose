import React, { useState, useMemo } from 'react';
import {
  useAccount, useConnect, useDisconnect,
  useReadContract, useWriteContract,
  usePublicClient,
} from 'wagmi';
import { injected } from '@wagmi/connectors';
import { parseUnits, formatUnits } from 'viem';
import { Archive, Wallet, ExternalLink, Loader, Settings2, DollarSign, AlertTriangle, CheckCircle } from 'lucide-react';
import { SWARM_FUND_ADDRESS, SEPOLIA_TOKENS, FUND_ABI, ERC20_ABI } from '../wagmi';

type Tab = 'overview' | 'deposit' | 'withdraw' | 'settings';

function truncate(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';
}

function TxButton({ onClick, disabled, loading, children, variant = 'primary' }: {
  onClick: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode; variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        background: disabled || loading
          ? 'rgba(255,255,255,0.05)'
          : variant === 'primary'
            ? 'rgba(250,204,21,0.15)'
            : 'rgba(6,182,212,0.12)',
        color: disabled || loading ? '#64748b' : variant === 'primary' ? '#facc15' : '#06b6d4',
        border: `1px solid ${disabled || loading ? 'rgba(255,255,255,0.08)' : variant === 'primary' ? 'rgba(250,204,21,0.3)' : 'rgba(6,182,212,0.25)'}`,
        padding: '0.6rem 1.2rem',
        borderRadius: '8px',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        fontWeight: 600,
        fontSize: '0.9rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
      }}
    >
      {loading && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
      {children}
    </button>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px dashed rgba(255,255,255,0.05)' }}>
      <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>{label}</span>
      <span style={{ fontFamily: 'monospace', fontWeight: 500, color: color || '#f1f5f9' }}>{value}</span>
    </div>
  );
}

/* ─── Earnings Projection ──────────────────────────────────────────────── */

interface ProjectionResult {
  signalsPerHour: number;
  avgDeviationPct: number;
  tradesPerDay: number;
  estProfitPerTrade: number;
  estProfitPerDay: number;
  estProfitPerWeek: number;
  tradeSizeUSD: number;
  canTrade: boolean;
  blockers: string[];
  readySignals: string[];
}

function calculateProjection(
  prices: { price: number; timestamp: number }[],
  tickWindow: number,
  buyThresholdPct: number,
  sellThresholdPct: number,
  vaultUsdc: number,
  vaultWeth: number,
  tradeLimitPct: number,
  wethPrice: number,
  scoutPollMs: number,
): ProjectionResult {
  const blockers: string[] = [];
  const readySignals: string[] = [];
  const totalVaultUSD = vaultUsdc + vaultWeth * wethPrice;
  const tradeSizeUSD = totalVaultUSD * (tradeLimitPct / 100);

  if (totalVaultUSD === 0) blockers.push('Vault is empty — deposit funds to start trading');
  if (tradeLimitPct === 0) blockers.push('Trade limit is 0 — set a trade limit in Vault Config');
  if (buyThresholdPct === 0 && sellThresholdPct === 0) blockers.push('Both thresholds are 0 — signals will never fire');
  if (tickWindow < 2) blockers.push('Tick window too small — minimum is 2');

  if (totalVaultUSD > 0) readySignals.push(`Vault balance: $${totalVaultUSD.toFixed(2)}`);
  if (tradeLimitPct > 0) readySignals.push(`Trade size: $${tradeSizeUSD.toFixed(2)} (${tradeLimitPct}% of vault)`);

  const priceVals = prices.map(p => p.price).filter(p => Number.isFinite(p) && p > 0);
  if (priceVals.length < Math.max(tickWindow + 2, 6)) {
    return {
      signalsPerHour: 0,
      avgDeviationPct: 0,
      tradesPerDay: 0,
      estProfitPerTrade: 0,
      estProfitPerDay: 0,
      estProfitPerWeek: 0,
      tradeSizeUSD,
      canTrade: blockers.length === 0,
      blockers,
      readySignals,
    };
  }

  let signalCount = 0;
  let totalDeviation = 0;

  for (let i = tickWindow; i < priceVals.length; i++) {
    const window = priceVals.slice(i - tickWindow, i);
    const avg = window.reduce((s, x) => s + x, 0) / window.length;
    if (!Number.isFinite(avg) || avg <= 0) continue;

    const currentPrice = priceVals[i];
    const devPct = ((currentPrice - avg) / avg) * 100;

    if (devPct <= -buyThresholdPct || devPct >= sellThresholdPct) {
      signalCount++;
      totalDeviation += Math.abs(devPct);
    }
  }

  const totalPairs = Math.max(1, priceVals.length - tickWindow);
  const signalRate = signalCount / totalPairs;

  const pollIntervalSec = scoutPollMs / 1000;
  const pollsPerHour = 3600 / pollIntervalSec;
  const signalsPerHour = +(signalRate * pollsPerHour).toFixed(1);
  const tradesPerDay = +(signalsPerHour * 24).toFixed(0);
  const avgDeviationPct = signalCount > 0 ? +(totalDeviation / signalCount).toFixed(4) : 0;

  // Est. profit per trade: the deviation captured minus threshold (simplified model)
  // A BUY signal fires when price drops X% below avg — we capture the mean reversion
  // Conservatively estimate 30% of the deviation as net profit after slippage/gas
  const capturePct = avgDeviationPct * 0.3;
  const estProfitPerTrade = +(tradeSizeUSD * capturePct / 100).toFixed(2);
  const estProfitPerDay = +(estProfitPerTrade * tradesPerDay).toFixed(2);
  const estProfitPerWeek = +(estProfitPerDay * 7).toFixed(2);

  return {
    signalsPerHour,
    avgDeviationPct,
    tradesPerDay: Math.trunc(tradesPerDay),
    estProfitPerTrade,
    estProfitPerDay,
    estProfitPerWeek,
    tradeSizeUSD,
    canTrade: blockers.length === 0,
    blockers,
    readySignals,
  };
}

/* ─── VaultPanel (tabs) ────────────────────────────────────────────────── */

function VaultPanel({
  address,
  swarmSettings,
  onSwarmSettingsChange,
  onUpdateSettings,
  updateStatus,
  scoutData,
}: {
  address: `0x${string}`;
  swarmSettings: { tickWindow: number; buyThresholdPct: number; sellThresholdPct: number };
  onSwarmSettingsChange: (s: Partial<{ tickWindow: number; buyThresholdPct: number; sellThresholdPct: number }>) => void;
  onUpdateSettings: () => void;
  updateStatus: 'idle' | 'ok' | 'error';
  scoutData: { prices: { price: number; timestamp: number }[]; latestPrice: number; scoutPollMs: number };
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [depositToken, setDepositToken] = useState<'USDC' | 'WETH'>('USDC');
  const [depositAmt, setDepositAmt] = useState('');
  const [withdrawToken, setWithdrawToken] = useState<'USDC' | 'WETH'>('USDC');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [newBot, setNewBot] = useState('');
  const [limitToken, setLimitToken] = useState<'USDC' | 'WETH'>('USDC');
  const [limitAmt, setLimitAmt] = useState('');
  const [txStatus, setTxStatus] = useState('');

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const tokenAddr = (sym: 'USDC' | 'WETH') => SEPOLIA_TOKENS[sym];
  const decimals = (sym: 'USDC' | 'WETH') => sym === 'USDC' ? 6 : 18;

  const useVaultRead = (fn: string, args: any[]) =>
    useReadContract({ address: SWARM_FUND_ADDRESS, abi: FUND_ABI, functionName: fn as any, args: args as any });

  const { data: botWallet, refetch: refetchBot } = useVaultRead('getBotWallet', [address]);
  const { data: usdcReal, refetch: r1 }        = useVaultRead('realBalance',       [address, SEPOLIA_TOKENS.USDC]);
  const { data: usdcNotional, refetch: r2 }    = useVaultRead('notionalBalance',   [address, SEPOLIA_TOKENS.USDC]);
  const { data: usdcInflight, refetch: r3 }    = useVaultRead('inflightFunds',     [address, SEPOLIA_TOKENS.USDC]);
  const { data: usdcLimit, refetch: r4 }       = useVaultRead('getTradeLimit',     [address, SEPOLIA_TOKENS.USDC]);
  const { data: usdcHarvest, refetch: r5 }     = useVaultRead('harvestableAmount', [address, SEPOLIA_TOKENS.USDC]);
  const { data: wethReal, refetch: r6 }        = useVaultRead('realBalance',       [address, SEPOLIA_TOKENS.WETH]);
  const { data: wethNotional, refetch: r7 }    = useVaultRead('notionalBalance',   [address, SEPOLIA_TOKENS.WETH]);
  const { data: wethInflight, refetch: r8 }    = useVaultRead('inflightFunds',     [address, SEPOLIA_TOKENS.WETH]);
  const { data: wethLimit, refetch: r9 }       = useVaultRead('getTradeLimit',     [address, SEPOLIA_TOKENS.WETH]);
  const { data: wethHarvest, refetch: r10 }    = useVaultRead('harvestableAmount', [address, SEPOLIA_TOKENS.WETH]);

  // Wallet balances (for deposit form)
  const { data: walletUsdc } = useReadContract({ address: SEPOLIA_TOKENS.USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] });
  const { data: walletWeth } = useReadContract({ address: SEPOLIA_TOKENS.WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] });
  const walletBal = depositToken === 'USDC' ? walletUsdc : walletWeth;
  const walletDecimals = depositToken === 'USDC' ? 6 : 18;

  const refetchAll = () => { r1(); r2(); r3(); r4(); r5(); r6(); r7(); r8(); r9(); r10(); refetchBot(); };

  const fmt = (val: bigint | undefined, dec: number, dp = 4) =>
    val !== undefined ? Number(formatUnits(val as bigint, dec)).toFixed(dp) : '…';

  const execTx = async (fn: () => Promise<`0x${string}`>, label: string) => {
    setTxStatus(`Sending ${label}…`);
    try {
      const hash = await fn();
      setTxStatus(`Waiting for confirmation…`);
      await publicClient!.waitForTransactionReceipt({ hash });
      setTxStatus(`✅ ${label} confirmed!`);
      refetchAll();
      setTimeout(() => setTxStatus(''), 4000);
    } catch (e: any) {
      setTxStatus(`❌ ${e.shortMessage ?? e.message}`);
      setTimeout(() => setTxStatus(''), 6000);
    }
  };

  const handleDeposit = async () => {
    const sym = depositToken;
    const amt = parseUnits(depositAmt, decimals(sym));
    const tok = tokenAddr(sym);

    // Pre-check: verify user has enough token balance in wallet
    const bal = await publicClient!.readContract({ address: tok, abi: ERC20_ABI, functionName: 'balanceOf', args: [address as `0x${string}`] });
    if (bal < amt) {
      const balStr = Number(formatUnits(bal as bigint, decimals(sym))).toFixed(4);
      setTxStatus(`❌ Insufficient ${sym}: wallet has ${balStr}, need ${depositAmt}`);
      setTimeout(() => setTxStatus(''), 8000);
      return;
    }

    await execTx(async () => {
      const appHash = await writeContractAsync({ address: tok, abi: ERC20_ABI, functionName: 'approve', args: [SWARM_FUND_ADDRESS, amt] });
      await publicClient!.waitForTransactionReceipt({ hash: appHash });
      setTxStatus('Approved! Depositing…');
      return writeContractAsync({ address: SWARM_FUND_ADDRESS, abi: FUND_ABI, functionName: 'deposit', args: [tok, amt] });
    }, `Deposit ${depositAmt} ${sym}`);
    setDepositAmt('');
  };

  const handleWithdraw = async () => {
    const sym = withdrawToken;
    const amt = parseUnits(withdrawAmt, decimals(sym));
    await execTx(() => writeContractAsync({ address: SWARM_FUND_ADDRESS, abi: FUND_ABI, functionName: 'withdraw', args: [tokenAddr(sym), amt] }), `Withdraw ${withdrawAmt} ${sym}`);
    setWithdrawAmt('');
  };

  const handleSetBot = async () => {
    await execTx(() => writeContractAsync({ address: SWARM_FUND_ADDRESS, abi: FUND_ABI, functionName: 'setBotWallet', args: [newBot as `0x${string}`] }), 'Set Bot Wallet');
    setNewBot('');
  };

  const handleSetLimit = async () => {
    const sym = limitToken;
    const amt = parseUnits(limitAmt, decimals(sym));
    await execTx(() => writeContractAsync({ address: SWARM_FUND_ADDRESS, abi: FUND_ABI, functionName: 'setTradeLimit', args: [tokenAddr(sym), amt] }), `Set ${sym} Limit`);
    setLimitAmt('');
  };

  const handleSetLimitPct = async (pct: number, token: 'USDC' | 'WETH', balance: bigint, dec: number) => {
    const bal = Number(formatUnits(balance, dec));
    const limit = (bal * pct / 100).toFixed(dec === 6 ? 2 : 6);
    setLimitToken(token);
    setLimitAmt(limit);
  };

  const tabStyle = (t: Tab) => ({
    padding: '0.5rem 1rem',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 600,
    background: tab === t ? 'rgba(250,204,21,0.12)' : 'transparent',
    color: tab === t ? '#facc15' : '#94a3b8',
    border: 'none',
  });

  const inputStyle: React.CSSProperties = {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#f1f5f9',
    padding: '0.6rem 0.8rem',
    borderRadius: '8px',
    fontSize: '0.9rem',
    flex: 1,
    outline: 'none',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    flex: 'none',
    width: '90px',
  };

  const usdcTradeLimitPct = usdcLimit !== undefined && usdcLimit > 0n && usdcReal !== undefined && usdcReal > 0n
    ? +(Number(formatUnits(usdcLimit, 6)) / Number(formatUnits(usdcReal, 6)) * 100).toFixed(1)
    : 0;

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
        {(['overview', 'deposit', 'withdraw', 'settings'] as Tab[]).map(t => (
          <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Status */}
      {txStatus && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '8px', background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.2)', color: '#facc15', fontSize: '0.9rem' }}>
          {txStatus}
        </div>
      )}

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {[
            { sym: 'USDC', real: usdcReal, notional: usdcNotional, inflight: usdcInflight, limit: usdcLimit, harvest: usdcHarvest, dec: 6 },
            { sym: 'WETH', real: wethReal, notional: wethNotional, inflight: wethInflight, limit: wethLimit, harvest: wethHarvest, dec: 18 },
          ].map(({ sym, real, notional, inflight, limit, harvest, dec }) => (
            <div key={sym} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1rem', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: sym === 'USDC' ? '#2563eb' : '#64748b' }} />
                {sym}
              </div>
              <MetricRow label="Real Balance"     value={fmt(real, dec)} />
              <MetricRow label="Inflight (Bot)"   value={fmt(inflight, dec)} color="#f59e0b" />
              <MetricRow label="Notional Balance" value={fmt(notional, dec)} color="#f1f5f9" />
              <MetricRow label="Trade Limit"      value={fmt(limit, dec)} color="#94a3b8" />
              <MetricRow label="Harvestable ✨"   value={fmt(harvest, dec)} color="#10b981" />
            </div>
          ))}
          <div style={{ gridColumn: '1/-1', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1rem', border: '1px solid rgba(255,255,255,0.06)' }}>
            <MetricRow label="Vault Owner"  value={truncate(address)} />
            <MetricRow label="Bot Wallet"   value={botWallet ? truncate(botWallet as string) : 'Not set'} color={botWallet ? '#06b6d4' : '#f43f5e'} />
            <div style={{ marginTop: '0.5rem' }}>
              <a href={`https://sepolia.etherscan.io/address/${SWARM_FUND_ADDRESS}`} target="_blank" rel="noreferrer"
                style={{ color: '#94a3b8', fontSize: '0.8rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ExternalLink size={12} /> View contract on Etherscan
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Tab */}
      {tab === 'deposit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '480px' }}>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Deposit tokens into your vault. You will be asked to approve the contract first, then deposit.</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select style={selectStyle} value={depositToken} onChange={e => setDepositToken(e.target.value as any)}>
              <option>USDC</option>
              <option>WETH</option>
            </select>
            <div style={{ flex: 1 }}>
              <input style={inputStyle} type="number" placeholder="Amount" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} />
              <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '2px' }}>
                Available: {walletBal !== undefined ? Number(formatUnits(walletBal as bigint, walletDecimals)).toFixed(4) : '…'} {depositToken}
              </div>
            </div>
          </div>
          <TxButton onClick={handleDeposit} disabled={
            !depositAmt ||
            parseFloat(depositAmt) <= 0 ||
            (walletBal !== undefined && parseFloat(depositAmt) > Number(formatUnits(walletBal as bigint, walletDecimals)))
          }>
            Approve & Deposit
          </TxButton>
        </div>
      )}

      {/* Withdraw Tab */}
      {tab === 'withdraw' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '480px' }}>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Withdraw tokens from your vault back to your wallet.</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select style={selectStyle} value={withdrawToken} onChange={e => setWithdrawToken(e.target.value as any)}>
              <option>USDC</option>
              <option>WETH</option>
            </select>
            <input style={inputStyle} type="number" placeholder="Amount" value={withdrawAmt} onChange={e => setWithdrawAmt(e.target.value)} />
          </div>
          <TxButton onClick={handleWithdraw} disabled={!withdrawAmt || parseFloat(withdrawAmt) <= 0}>
            Withdraw
          </TxButton>
        </div>
      )}

      {/* Settings Tab — unified Swarm + Vault config + Earnings Projection */}
      {tab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Earnings Projection */}
          <EarningsProjection
            usdcReal={usdcReal}
            wethReal={wethReal}
            usdcLimit={usdcLimit}
            swarmSettings={swarmSettings}
            prices={scoutData.prices}
            latestPrice={scoutData.latestPrice}
            scoutPollMs={scoutData.scoutPollMs}
          />

          {/* ── Swarm Trading Configuration ─────────────────────────── */}
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Settings2 size={18} className="text-gold" /> Swarm Trading Configuration
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Controls how sensitive the swarm is to price movements. Lower thresholds and smaller tick windows trigger more trades.
            </div>

            {/* Tick Window */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'block', marginBottom: '0.35rem' }}>Tick Window</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="number"
                  value={swarmSettings.tickWindow}
                  onChange={e => onSwarmSettingsChange({ tickWindow: parseInt(e.target.value) || 2 })}
                  min="2"
                  max="50"
                  style={{ ...inputStyle, width: '100px', flex: 'none' }}
                />
                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                  Recent ticks used for rolling average (2 = most sensitive)
                </span>
              </div>
            </div>

            {/* Thresholds */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'block', marginBottom: '0.35rem' }}>BUY Threshold (%)</label>
                <input
                  type="number"
                  value={swarmSettings.buyThresholdPct}
                  onChange={e => onSwarmSettingsChange({ buyThresholdPct: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step="0.001"
                  style={{ ...inputStyle, textAlign: 'center' }}
                />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'block', marginBottom: '0.35rem' }}>SELL Threshold (%)</label>
                <input
                  type="number"
                  value={swarmSettings.sellThresholdPct}
                  onChange={e => onSwarmSettingsChange({ sellThresholdPct: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step="0.001"
                  style={{ ...inputStyle, textAlign: 'center' }}
                />
              </div>
            </div>

            {/* Quick presets */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <span style={{ color: '#64748b', fontSize: '0.78rem', alignSelf: 'center' }}>Presets:</span>
              <button
                onClick={() => onSwarmSettingsChange({ tickWindow: 2, buyThresholdPct: 0.0004, sellThresholdPct: 0.0004 })}
                style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}
              >
                Hyper (1¢ moves)
              </button>
              <button
                onClick={() => onSwarmSettingsChange({ tickWindow: 3, buyThresholdPct: 0.004, sellThresholdPct: 0.004 })}
                style={{ background: 'rgba(250,204,21,0.1)', color: '#facc15', border: '1px solid rgba(250,204,21,0.2)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}
              >
                Aggressive (10¢)
              </button>
              <button
                onClick={() => onSwarmSettingsChange({ tickWindow: 5, buyThresholdPct: 0.009, sellThresholdPct: 0.009 })}
                style={{ background: 'rgba(249,115,22,0.1)', color: '#f97316', border: '1px solid rgba(249,115,22,0.2)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}
              >
                Moderate (20¢)
              </button>
            </div>

            <TxButton
              onClick={onUpdateSettings}
              disabled={updateStatus === 'ok'}
              variant="primary"
            >
              {updateStatus === 'ok' ? '✓ Updated' : updateStatus === 'error' ? '✗ Failed — Retry' : 'Apply Swarm Settings'}
            </TxButton>
          </div>

          {/* ── Vault Configuration ─────────────────────────────────── */}
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Wallet size={18} className="text-cyan" /> Vault Configuration
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Authorize the bot and set per-token trade limits. Max trade size defaults to 50% of your vault balance.
            </div>

            {/* Bot Wallet */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'block', marginBottom: '0.35rem' }}>Authorized Bot Wallet</label>
              <div style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                Current: <span style={{ color: botWallet ? '#06b6d4' : '#f43f5e', fontFamily: 'monospace' }}>{botWallet ? botWallet : 'Not set'}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input style={inputStyle} placeholder="0x... bot wallet address" value={newBot} onChange={e => setNewBot(e.target.value)} />
                <TxButton onClick={handleSetBot} disabled={!newBot.startsWith('0x') || newBot.length < 42}>Set</TxButton>
              </div>
            </div>

            {/* Trade Limits */}
            <div>
              <label style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'block', marginBottom: '0.5rem' }}>Trade Limit Per Swap</label>
              <div style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                Current USDC limit: {usdcTradeLimitPct > 0 ? `${usdcTradeLimitPct}% of vault` : 'Not set'}
              </div>

              {/* Quick 50% buttons */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => usdcReal !== undefined && wethReal !== undefined && handleSetLimitPct(50, 'USDC', usdcReal as bigint, 6)}
                  style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}
                >
                  50% USDC vault
                </button>
                <button
                  onClick={() => usdcReal !== undefined && wethReal !== undefined && handleSetLimitPct(50, 'WETH', wethReal as bigint, 18)}
                  style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}
                >
                  50% WETH vault
                </button>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select style={selectStyle} value={limitToken} onChange={e => setLimitToken(e.target.value as any)}>
                  <option>USDC</option>
                  <option>WETH</option>
                </select>
                <input style={inputStyle} type="number" placeholder="Limit amount" value={limitAmt} onChange={e => setLimitAmt(e.target.value)} />
                <TxButton onClick={handleSetLimit} disabled={!limitAmt || parseFloat(limitAmt) <= 0}>Set Limit</TxButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Earnings Projection Component ──────────────────────────────────── */

function EarningsProjection({
  usdcReal,
  wethReal,
  usdcLimit,
  swarmSettings,
  prices,
  latestPrice,
  scoutPollMs,
}: {
  usdcReal: bigint | undefined;
  wethReal: bigint | undefined;
  usdcLimit: bigint | undefined;
  swarmSettings: { tickWindow: number; buyThresholdPct: number; sellThresholdPct: number };
  prices: { price: number; timestamp: number }[];
  latestPrice: number;
  scoutPollMs: number;
}) {

  const vaultUsdc = usdcReal !== undefined ? Number(formatUnits(usdcReal as bigint, 6)) : 0;
  const vaultWeth = wethReal !== undefined ? Number(formatUnits(wethReal as bigint, 18)) : 0;
  const limitUsdc = usdcLimit !== undefined ? Number(formatUnits(usdcLimit as bigint, 6)) : 0;
  const tradeLimitPct = vaultUsdc > 0 ? +(limitUsdc / vaultUsdc * 100).toFixed(1) : 0;

  const projection = useMemo(() => {
    return calculateProjection(
      prices,
      swarmSettings.tickWindow,
      swarmSettings.buyThresholdPct,
      swarmSettings.sellThresholdPct,
      vaultUsdc,
      vaultWeth,
      tradeLimitPct,
      latestPrice,
      scoutPollMs,
    );
  }, [prices, swarmSettings, vaultUsdc, vaultWeth, tradeLimitPct, latestPrice, scoutPollMs]);

  return (
    <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <DollarSign size={18} className="text-gold" /> Earnings Projection
      </div>
      <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Estimated returns based on recent price history and your current settings.
      </div>

      {/* Status badges */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {projection.canTrade ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
            <CheckCircle size={14} /> Ready to Trade
          </span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(244,63,94,0.1)', color: '#f43f5e', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
            <AlertTriangle size={14} /> Configuration Needed
          </span>
        )}
      </div>

      {/* Blockers */}
      {projection.blockers.length > 0 && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '8px', background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', fontSize: '0.85rem' }}>
          {projection.blockers.map((b, i) => (
            <div key={i} style={{ color: '#fda4af', marginBottom: i < projection.blockers.length - 1 ? '0.25rem' : 0 }}>⚠ {b}</div>
          ))}
        </div>
      )}

      {/* Ready signals */}
      {projection.readySignals.length > 0 && (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {projection.readySignals.map((s, i) => (
            <span key={i} style={{ color: '#94a3b8', fontSize: '0.82rem' }}>✓ {s}</span>
          ))}
        </div>
      )}

      {/* Projection metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        {[
          { label: 'Est. Signals/Hour', value: `${projection.signalsPerHour}`, sub: `at ${scoutPollMs / 1000}s poll`, color: '#06b6d4' },
          { label: 'Est. Trades/Day', value: `${projection.tradesPerDay}`, sub: 'based on recent volatility', color: '#8b5cf6' },
          { label: 'Trade Size', value: `$${projection.tradeSizeUSD.toFixed(2)}`, sub: `${tradeLimitPct}% of vault`, color: '#f59e0b' },
          { label: 'Est. Profit/Trade', value: `$${projection.estProfitPerTrade.toFixed(2)}`, sub: `avg dev ${projection.avgDeviationPct.toFixed(3)}%`, color: projection.estProfitPerTrade >= 0 ? '#10b981' : '#f43f5e' },
          { label: 'Est. Profit/Day', value: `$${projection.estProfitPerDay.toFixed(2)}`, sub: '', color: projection.estProfitPerDay >= 0 ? '#10b981' : '#f43f5e' },
          { label: 'Est. Profit/Week', value: `$${projection.estProfitPerWeek.toFixed(2)}`, sub: '', color: projection.estProfitPerWeek >= 0 ? '#10b981' : '#f43f5e' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '10px', padding: '0.85rem', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: '0.35rem' }}>{label}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
            {sub && <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '0.2rem' }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* Price context */}
      <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', fontSize: '0.8rem', color: '#64748b' }}>
        WETH: ${latestPrice.toFixed(2)} · {prices.length} ticks tracked · 1¢ move = {((0.01 / latestPrice) * 100).toFixed(4)}%
      </div>
    </div>
  );
}

/* ─── MyVault (outer wrapper) ────────────────────────────────────────── */

export default function MyVault({
  swarmSettings,
  onSwarmSettingsChange,
  onUpdateSettings,
  updateStatus,
  scoutData,
}: {
  swarmSettings: { tickWindow: number; buyThresholdPct: number; sellThresholdPct: number };
  onSwarmSettingsChange: (s: Partial<{ tickWindow: number; buyThresholdPct: number; sellThresholdPct: number }>) => void;
  onUpdateSettings: () => void;
  updateStatus: 'idle' | 'ok' | 'error';
  scoutData: { prices: { price: number; timestamp: number }[]; latestPrice: number; scoutPollMs: number };
}) {
  const { address, isConnected, chain } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <div style={{ marginTop: '2rem', background: 'var(--panel-bg)', borderRadius: '16px', border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <Archive size={20} style={{ color: '#facc15' }} /> SwarmFund — My Vault
        </h2>

        {isConnected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ fontSize: '0.85rem' }}>
              <span style={{ color: '#94a3b8' }}>{chain?.name ?? 'Unknown'} · </span>
              <span style={{ fontFamily: 'monospace', color: '#06b6d4' }}>{truncate(address!)}</span>
            </div>
            <button onClick={() => disconnect()} style={{ background: 'rgba(244,63,94,0.1)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)', padding: '0.3rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => connect({ connector: injected() })}
            style={{ background: 'rgba(6,182,212,0.1)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', padding: '0.5rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Wallet size={16} /> Connect Wallet
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '1.5rem' }}>
        {!isConnected ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '3rem 0' }}>
            <Wallet size={40} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
            <p style={{ marginBottom: '0.5rem', fontWeight: 500 }}>Connect your wallet to manage your vault</p>
            <p style={{ fontSize: '0.85rem' }}>Deposit, withdraw, and configure your bot's trading parameters.</p>
          </div>
        ) : chain?.id !== 11155111 ? (
          <div style={{ textAlign: 'center', color: '#f43f5e', padding: '2rem' }}>
            ⚠️ Please switch your wallet to <strong>Sepolia</strong> to interact with the fund.
          </div>
        ) : (
          <VaultPanel
            address={address!}
            swarmSettings={swarmSettings}
            onSwarmSettingsChange={onSwarmSettingsChange}
            onUpdateSettings={onUpdateSettings}
            updateStatus={updateStatus}
            scoutData={scoutData}
          />
        )}
      </div>
    </div>
  );
}
