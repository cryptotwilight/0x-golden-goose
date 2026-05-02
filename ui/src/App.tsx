import React, { useState, useEffect, useMemo } from 'react';
import { Search, ShieldAlert, Zap, Server, Settings, TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';

export default function App() {
  const [apiUrl, setApiUrl] = useState('http://localhost:3001');
  const [data, setData] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [tickWindow, setTickWindow] = useState<number>(5);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/stats`);
        if (!response.ok) throw new Error('Network response was not ok');
        const json = await response.json();
        setData(json);
        setIsConnected(true);
        if (json.scout?.tickWindowSize) {
          setTickWindow(json.scout.tickWindowSize);
        }
      } catch (error) {
        setIsConnected(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const updateTickWindow = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setTickWindow(val);
    if (val > 0) {
      try {
        await fetch(`${apiUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickWindowSize: val })
        });
      } catch(e) {}
    }
  };

  const formatDelta = (pct: number) => {
    if (pct === 0) return <span className="text-gray">0.00%</span>;
    if (pct > 0) return <span className="text-green">+{pct.toFixed(2)}%</span>;
    return <span className="text-red">{pct.toFixed(2)}%</span>;
  };

  const getArrow = (pct: number) => {
    if (pct > 0) return <TrendingUp size={16} className="text-green" />;
    if (pct < 0) return <TrendingDown size={16} className="text-red" />;
    return <Minus size={16} className="text-gray" />;
  };

  // Trade History and P&L Logic
  const { trades, totalReturnPct } = useMemo(() => {
    if (!data?.executor?.tradeHistory || !data?.scout?.latestPrice) {
      return { trades: [], totalReturnPct: 0 };
    }
    
    let cumulativeReturn = 0;
    const currentPrice = data.scout.latestPrice;

    const enrichedTrades = [...data.executor.tradeHistory].reverse().map((t: any) => {
      let isWin = false;
      let pnlPct = 0;
      
      if (t.executionPrice > 0) {
        if (t.direction === 'BUY') {
          pnlPct = ((currentPrice - t.executionPrice) / t.executionPrice) * 100;
        } else if (t.direction === 'SELL') {
          pnlPct = ((t.executionPrice - currentPrice) / t.executionPrice) * 100;
        }
        isWin = pnlPct > 0;
        if (t.status === 'confirmed') cumulativeReturn += pnlPct;
      }
      return { ...t, isWin, pnlPct };
    });

    return { trades: enrichedTrades, totalReturnPct: cumulativeReturn };
  }, [data]);

  return (
    <div className="dashboard-container">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <img 
            src="/logo.png" 
            alt="0x Golden Goose Logo" 
            style={{ 
              width: '56px', 
              height: '56px', 
              borderRadius: '12px',
              boxShadow: '0 0 15px rgba(250, 204, 21, 0.2)'
            }} 
          />
          <div className="title-group">
            <h1>0x Golden Goose</h1>
            <div className="subtitle">AI-Powered Multi-Agent DEX Trading Swarm</div>
          </div>
        </div>

        <div className="connection-settings">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: '1rem' }}>
            <Settings size={16} className="text-gray" />
            <label>Ticks Window</label>
            <input 
              type="number" 
              value={tickWindow} 
              onChange={updateTickWindow}
              style={{ width: '60px', textAlign: 'center' }}
              min="2"
              max="50"
            />
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '0.5rem' }}>
            <Server size={16} className="text-gray" />
            <input 
              type="text" 
              value={apiUrl} 
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://localhost:3001"
              style={{ width: '200px' }}
            />
            <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              <div className="pulse"></div>
              {isConnected ? 'LIVE' : 'OFFLINE'}
            </div>
          </div>
        </div>
      </header>

      {!data && isConnected && (
        <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: '4rem' }}>
          Loading swarm data...
        </div>
      )}

      {data && (
        <>
          <div className="agents-grid">
            {/* PriceScout Card */}
            <div className="agent-card scout">
              <div className="card-header">
                <div className="card-title">
                  <div className="icon-wrapper"><Search size={20} /></div>
                  PriceScout
                </div>
                <div className={`axl-badge ${data.scout.axlConnected ? 'connected' : 'disconnected'}`}>
                  {data.scout.axlConnected ? '● AXL' : '● local-bus'}
                </div>
              </div>
              <div className="ens-name">{data.scout.ensName}</div>

              <div className="metrics-list">
                <div className="metric-row">
                  <span className="metric-label">Uptime</span>
                  <span className="metric-value">{data.scout.uptime}s</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Price Ticks</span>
                  <span className="metric-value">{data.scout.ticks}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Signals Emitted</span>
                  <span className="metric-value">{data.scout.totalSignals}</span>
                </div>
              </div>

              <div className="highlight-box">
                <div className="metric-label">Latest Market Data</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="metric-value text-gold" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    ${data.scout.latestPrice?.toFixed(2)}
                    {getArrow(data.scout.latestChangePct)}
                  </span>
                  <span className="metric-value">{formatDelta(data.scout.latestChangePct)}</span>
                  <span className={`metric-value ${data.scout.latestDirection === 'BUY' ? 'text-green' : data.scout.latestDirection === 'SELL' ? 'text-red' : 'text-gray'}`}>
                    {data.scout.latestDirection}
                  </span>
                </div>
              </div>
            </div>

            {/* RiskManager Card */}
            <div className="agent-card risk">
              <div className="card-header">
                <div className="card-title">
                  <div className="icon-wrapper"><ShieldAlert size={20} /></div>
                  RiskManager
                </div>
                <div className={`axl-badge ${data.risk.axlConnected ? 'connected' : 'disconnected'}`}>
                  {data.risk.axlConnected ? '● AXL' : '● local-bus'}
                </div>
              </div>
              <div className="ens-name">{data.risk.ensName}</div>

              <div className="metrics-list">
                <div className="metric-row">
                  <span className="metric-label">Uptime</span>
                  <span className="metric-value">{data.risk.uptime}s</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Total Decisions</span>
                  <span className="metric-value">{data.risk.totalDecisions}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Approved / Rejected</span>
                  <span className="metric-value">
                    <span className="text-green">{data.risk.totalApproved}</span> / <span className="text-red">{data.risk.totalRejected}</span>
                  </span>
                </div>
              </div>

              <div className="highlight-box">
                <div className="metric-label">Latest Decision</div>
                <div className="metric-value" style={{ fontSize: '0.9rem' }}>
                  {data.risk.latestDecision ? (
                    data.risk.latestDecision.approved 
                      ? <span className="text-green">✅ APPROVED (risk {data.risk.latestDecision.riskScore.toFixed(1)})</span>
                      : <span className="text-red">❌ {data.risk.latestDecision.reason.slice(0, 35)}...</span>
                  ) : (
                    <span className="text-gray">Waiting for signals...</span>
                  )}
                </div>
              </div>
            </div>

            {/* Executor Card */}
            <div className="agent-card executor">
              <div className="card-header">
                <div className="card-title">
                  <div className="icon-wrapper"><Zap size={20} /></div>
                  Executor
                </div>
                <div className={`axl-badge ${data.executor.axlConnected ? 'connected' : 'disconnected'}`}>
                  {data.executor.axlConnected ? '● AXL' : '● local-bus'}
                </div>
              </div>
              <div className="ens-name">{data.executor.ensName}</div>

              <div className="metrics-list">
                <div className="metric-row">
                  <span className="metric-label">Mode</span>
                  <span className={`metric-value ${data.executor.liveMode ? 'text-red' : 'text-gold'}`}>
                    {data.executor.liveMode ? 'LIVE (Sepolia)' : 'SIMULATE'}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Wallet</span>
                  <span className="metric-value text-gray" style={{ fontSize: '0.8rem' }}>
                    {data.executor.walletAddress}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Balance</span>
                  <span className="metric-value text-gold" style={{ fontSize: '0.8rem' }}>
                    {data.executor.walletBalance}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Success / Failed</span>
                  <span className="metric-value">
                    <span className="text-green">{data.executor.totalSuccess}</span> / <span className="text-red">{data.executor.totalFailed}</span>
                  </span>
                </div>
              </div>

              <div className="highlight-box">
                <div className="metric-label">Latest Transaction</div>
                <div className="metric-value" style={{ fontSize: '0.85rem' }}>
                  {data.executor.latestResult ? (
                    data.executor.latestResult.status === 'confirmed'
                      ? <span className="text-green">✅ {data.executor.latestResult.txHash?.slice(0, 24)}...</span>
                      : <span className="text-red">❌ {data.executor.latestResult.error?.slice(0, 30) ?? 'Failed'}</span>
                  ) : (
                    <span className="text-gray">No trades yet...</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* P&L and Trade History Section */}
          <div style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Activity size={20} className="text-cyan" /> Trade History
              </h2>
              
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem 1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span className="text-gray" style={{ fontSize: '0.85rem' }}>Rolling Simulated P&L</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: totalReturnPct >= 0 ? '#10b981' : '#f43f5e' }}>
                  {totalReturnPct >= 0 ? '+' : ''}{totalReturnPct.toFixed(2)}%
                </span>
              </div>
            </div>

            <div style={{ background: 'var(--panel-bg)', borderRadius: '16px', border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
              {trades.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No trades executed yet. Waiting for market signals...
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>Time</th>
                      <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>Direction</th>
                      <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>Exec Price</th>
                      <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>Current Price</th>
                      <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>Unrealized P&L</th>
                      <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '1rem', fontFamily: 'monospace' }}>
                          {new Date(t.timestamp).toLocaleTimeString()}
                        </td>
                        <td style={{ padding: '1rem' }}>
                          <span className={`axl-badge ${t.direction === 'BUY' ? 'connected' : 'disconnected'}`} style={{ border: 'none' }}>
                            {t.direction}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', fontFamily: 'monospace' }}>
                          ${t.executionPrice?.toFixed(2) || '---'}
                        </td>
                        <td style={{ padding: '1rem', fontFamily: 'monospace' }}>
                          ${data.scout.latestPrice?.toFixed(2)}
                        </td>
                        <td style={{ padding: '1rem', fontFamily: 'monospace', color: t.pnlPct >= 0 ? '#10b981' : '#f43f5e' }}>
                          {t.pnlPct > 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
                        </td>
                        <td style={{ padding: '1rem' }}>
                          {t.status === 'confirmed' ? (
                            t.isWin ? <span className="text-green">✅ Winning</span> : <span className="text-red">❌ Losing</span>
                          ) : (
                            <span className="text-gray">Failed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
