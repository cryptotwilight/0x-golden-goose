import React, { useState } from 'react';
import {
  useAccount, useConnect, useDisconnect,
  useReadContract, useWriteContract,
  usePublicClient,
} from 'wagmi';
import { injected } from '@wagmi/connectors';
import { parseUnits, formatUnits } from 'viem';
import { Archive, Wallet, ExternalLink, Loader } from 'lucide-react';
import { SWARM_FUND_ADDRESS, SEPOLIA_TOKENS, FUND_ABI, ERC20_ABI } from '../wagmi';

type Tab = 'overview' | 'deposit' | 'withdraw' | 'settings';

function truncate(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';
}

function TxButton({ onClick, disabled, loading, children }: {
  onClick: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        background: disabled || loading ? 'rgba(255,255,255,0.05)' : 'rgba(250,204,21,0.15)',
        color: disabled || loading ? '#64748b' : '#facc15',
        border: `1px solid ${disabled || loading ? 'rgba(255,255,255,0.08)' : 'rgba(250,204,21,0.3)'}`,
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

function VaultPanel({ address }: { address: `0x${string}` }) {
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

  // Read vault data
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
    await execTx(async () => {
      // Approve first
      const appHash = await writeContractAsync({ address: tokenAddr(sym), abi: ERC20_ABI, functionName: 'approve', args: [SWARM_FUND_ADDRESS, amt] });
      await publicClient!.waitForTransactionReceipt({ hash: appHash });
      setTxStatus('Approved! Depositing…');
      return writeContractAsync({ address: SWARM_FUND_ADDRESS, abi: FUND_ABI, functionName: 'deposit', args: [tokenAddr(sym), amt] });
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
            <input style={inputStyle} type="number" placeholder="Amount" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} />
          </div>
          <TxButton onClick={handleDeposit} disabled={!depositAmt || parseFloat(depositAmt) <= 0}>
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

      {/* Settings Tab */}
      {tab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '540px' }}>
          {/* Bot Wallet */}
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1rem', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Authorized Bot Wallet</div>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Current: <span style={{ color: '#06b6d4', fontFamily: 'monospace' }}>{botWallet ? botWallet as string : 'Not set'}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input style={inputStyle} placeholder="0x... new bot address" value={newBot} onChange={e => setNewBot(e.target.value)} />
              <TxButton onClick={handleSetBot} disabled={!newBot.startsWith('0x')}>Set</TxButton>
            </div>
          </div>

          {/* Trade Limit */}
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1rem', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Trade Limit Per Swap</div>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Max amount the bot can withdraw in a single trade.
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select style={selectStyle} value={limitToken} onChange={e => setLimitToken(e.target.value as any)}>
                <option>USDC</option>
                <option>WETH</option>
              </select>
              <input style={inputStyle} type="number" placeholder="Limit amount" value={limitAmt} onChange={e => setLimitAmt(e.target.value)} />
              <TxButton onClick={handleSetLimit} disabled={!limitAmt || parseFloat(limitAmt) <= 0}>Set</TxButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyVault() {
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
          <VaultPanel address={address!} />
        )}
      </div>
    </div>
  );
}
