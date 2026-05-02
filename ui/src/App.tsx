import { useState, useEffect, useMemo } from 'react';
import { Search, ShieldAlert, Zap, Server, Settings, TrendingUp, TrendingDown, Minus, Activity, Clock, Blocks } from 'lucide-react';
import MyVault from './components/MyVault';

function normalizeApiBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function initialApiBase(): string {
  const fromEnv =
    typeof import.meta.env.VITE_API_BASE_URL === 'string' && import.meta.env.VITE_API_BASE_URL.trim();
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return 'http://127.0.0.1:3001';
  // Production build served from this machine (Vite preview, Firebase emulator, etc.)
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://127.0.0.1:3001';
  }
  return '';
}

export default function App() {
  const [apiUrl, setApiUrl] = useState(initialApiBase);
  const [data, setData] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tickWindow, setTickWindow] = useState<number>(5);
  const [isUpdatingTick, setIsUpdatingTick] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [buyThresholdPct, setBuyThresholdPct] = useState<number>(1.5);
  const [sellThresholdPct, setSellThresholdPct] = useState<number>(1.5);

  // Tick-window recommender
  const [targetMoveCents, setTargetMoveCents] = useState<number>(10); // $0.10 default
  const [recommendedTickWindow, setRecommendedTickWindow] = useState<number | null>(null);
  const [recommendationNote, setRecommendationNote] = useState<string>('');

  useEffect(() => {
    const base = normalizeApiBase(apiUrl);
    if (!base) {
      setData(null);
      setIsConnected(false);
      setFetchError('Set the swarm API URL (your machine: ngrok → port 3001, or VITE_API_BASE_URL at build time).');
      return;
    }

    const fetchData = async () => {
      try {
        const response = await fetch(`${base}/api/stats`, {
          headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        const ct = response.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) {
          throw new Error('Not JSON (tunnel down, wrong URL, or ngrok interstitial HTML).');
        }
        const json = await response.json();
        setData(json);
        setIsConnected(true);
        setFetchError(null);
        // Only set initial tick window if we haven't modified it locally
        if (json.scout?.tickWindowSize && tickWindow === 5 && !isUpdatingTick) {
          setTickWindow(json.scout.tickWindowSize);
        }
        if (typeof json.scout?.buyThresholdPct === 'number' && Number.isFinite(json.scout.buyThresholdPct)) {
          setBuyThresholdPct(json.scout.buyThresholdPct);
        }
        if (typeof json.scout?.sellThresholdPct === 'number' && Number.isFinite(json.scout.sellThresholdPct)) {
          setSellThresholdPct(json.scout.sellThresholdPct);
        }
      } catch (error) {
        setIsConnected(false);
        setData(null);
        setFetchError(error instanceof Error ? error.message : 'Request failed');
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const submitTickWindow = async () => {
    const base = normalizeApiBase(apiUrl);
    if (!base) return;
    setIsUpdatingTick(true);
    try {
      await fetch(`${base}/api/settings`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          tickWindowSize: tickWindow,
          buyThresholdPct,
          sellThresholdPct,
        })
      });
    } catch(e) {}
    setTimeout(() => setIsUpdatingTick(false), 1000);
  };

  const computeTickRecommendation = () => {
    const prices: number[] = (data?.scout?.recentPrices ?? [])
      .map((p: any) => Number(p?.price))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    const latest = Number(data?.scout?.latestPrice);
    if (!Number.isFinite(latest) || latest <= 0) {
      setRecommendedTickWindow(null);
      setRecommendationNote('No latest price yet.');
      return;
    }
    if (prices.length < 12) {
      setRecommendedTickWindow(null);
      setRecommendationNote('Not enough recent ticks yet (need ~12+).');
      return;
    }

    const cents = Number(targetMoveCents);
    if (!Number.isFinite(cents) || cents <= 0) {
      setRecommendedTickWindow(null);
      setRecommendationNote('Enter a target move in cents (> 0).');
      return;
    }

    const targetAbs = cents / 100; // dollars
    const targetPct = (targetAbs / latest) * 100;

    const maxW = Math.min(50, Math.max(2, prices.length - 2));
    let best: number | null = null;
    let bestScore = -Infinity;

    // Score each window size by "how often deviation >= targetPct" across recent history.
    for (let w = 2; w <= maxW; w++) {
      const deviations: number[] = [];
      for (let i = w; i < prices.length; i++) {
        const window = prices.slice(i - w, i);
        const avg = window.reduce((s, x) => s + x, 0) / window.length;
        if (!Number.isFinite(avg) || avg <= 0) continue;
        const dev = Math.abs((prices[i] - avg) / avg) * 100;
        deviations.push(dev);
      }
      if (deviations.length < 5) continue;

      const hitRate = deviations.filter((d) => d >= targetPct).length / deviations.length;
      const meanDev = deviations.reduce((s, d) => s + d, 0) / deviations.length;

      // Prefer windows that hit consistently; meanDev breaks ties.
      const score = hitRate * 1000 + meanDev;
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    }

    if (!best) {
      setRecommendedTickWindow(null);
      setRecommendationNote('Could not compute a recommendation from current tick history.');
      return;
    }

    const buy = Number(data?.scout?.buyThresholdPct);
    const sell = Number(data?.scout?.sellThresholdPct);
    const thrNote =
      Number.isFinite(buy) && Number.isFinite(sell)
        ? `Current thresholds: BUY ${buy}% / SELL ${sell}%. To trade on ~$${targetAbs.toFixed(2)} moves at ~$${latest.toFixed(2)}, thresholds usually need to be <= ${targetPct.toFixed(4)}%.`
        : `To trade on ~$${targetAbs.toFixed(2)} moves at ~$${latest.toFixed(2)}, thresholds usually need to be <= ${targetPct.toFixed(4)}%.`;

    setRecommendedTickWindow(best);
    setRecommendationNote(
      `Target move: ~$${targetAbs.toFixed(2)} (~${targetPct.toFixed(4)}%). Recommended tick window: ${best}. Any setting below ${best} will be more sensitive. ${thrNote}`
    );
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

  const timeAgo = (ts: number): string => {
    if (!ts) return 'Never';
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 5) return 'Just now';
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
    return `${Math.floor(secs / 3600)}h ago`;
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '0.5rem' }}>
            <button
              onClick={() => setShowSettings((s) => !s)}
              title="Open settings"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
              }}
            >
              <Settings size={16} className="text-gray" />
            </button>
            <Server size={16} className="text-gray" />
            <input 
              type="text" 
              value={apiUrl} 
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://xxxx.ngrok-free.app (no trailing /)"
              style={{ minWidth: 'min(420px, 55vw)', flex: '1 1 200px', maxWidth: '560px' }}
            />
            <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              <div className="pulse"></div>
              {isConnected ? 'LIVE' : 'OFFLINE'}
            </div>
          </div>
        </div>
      </header>

      {showSettings && (
        <div
          style={{
            marginTop: '1.25rem',
            background: 'rgba(0,0,0,0.28)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px',
            padding: '1rem 1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ minWidth: '280px' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Swarm Settings</div>
              <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                Tick window controls the rolling baseline used for signal detection. Smaller windows react faster (more trading).
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Tick window</div>
                <input
                  type="number"
                  value={tickWindow}
                  onChange={(e) => setTickWindow(parseInt(e.target.value) || 0)}
                  min="2"
                  max="50"
                  style={{ width: '90px', textAlign: 'center' }}
                />
              </div>
              <button
                onClick={submitTickWindow}
                disabled={isUpdatingTick}
                style={{
                  background: 'rgba(250, 204, 21, 0.2)',
                  color: '#facc15',
                  border: '1px solid rgba(250, 204, 21, 0.3)',
                  padding: '8px 14px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  opacity: isUpdatingTick ? 0.7 : 1,
                }}
              >
                {isUpdatingTick ? 'Updating…' : 'Update'}
              </button>
            </div>
          </div>

          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Tick setting recommender</div>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Enter the price move you care about (in cents). We’ll analyze recent ticks and suggest a tick window where any smaller window should be sensitive enough to trade more often.
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <div>
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.25rem' }}>BUY threshold (%)</div>
                <input
                  type="number"
                  value={buyThresholdPct}
                  onChange={(e) => setBuyThresholdPct(parseFloat(e.target.value) || 0)}
                  min="0"
                  step="0.0001"
                  style={{ width: '140px', textAlign: 'center' }}
                />
              </div>
              <div>
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.25rem' }}>SELL threshold (%)</div>
                <input
                  type="number"
                  value={sellThresholdPct}
                  onChange={(e) => setSellThresholdPct(parseFloat(e.target.value) || 0)}
                  min="0"
                  step="0.0001"
                  style={{ width: '140px', textAlign: 'center' }}
                />
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.1rem' }}>
                Included when you click <strong>Update</strong> above.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Target move (¢)</div>
                <input
                  type="number"
                  value={targetMoveCents}
                  onChange={(e) => setTargetMoveCents(parseFloat(e.target.value) || 0)}
                  min="1"
                  max="500"
                  style={{ width: '110px', textAlign: 'center' }}
                />
              </div>
              <button
                onClick={computeTickRecommendation}
                style={{
                  background: 'rgba(6,182,212,0.12)',
                  color: '#06b6d4',
                  border: '1px solid rgba(6,182,212,0.25)',
                  padding: '8px 14px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                }}
              >
                Recommend
              </button>
              {recommendedTickWindow != null && (
                <button
                  onClick={() => { setTickWindow(recommendedTickWindow); }}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    color: '#e2e8f0',
                    border: '1px solid rgba(255,255,255,0.10)',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                  }}
                >
                  Use {recommendedTickWindow}
                </button>
              )}
            </div>

            {(recommendationNote || recommendedTickWindow != null) && (
              <div
                style={{
                  marginTop: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  color: '#cbd5e1',
                  fontSize: '0.9rem',
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                }}
              >
                {recommendationNote || (recommendedTickWindow != null ? `Recommended tick window: ${recommendedTickWindow}` : '')}
              </div>
            )}
          </div>
        </div>
      )}

      {!data && isConnected && (
        <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: '4rem' }}>
          Loading swarm data...
        </div>
      )}

      {!data && !isConnected && (
        <div
          style={{
            marginTop: '3rem',
            marginLeft: 'auto',
            marginRight: 'auto',
            maxWidth: '640px',
            padding: '1.5rem',
            borderRadius: '16px',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(0,0,0,0.35)',
            color: '#cbd5e1',
            lineHeight: 1.6,
          }}
        >
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#f1f5f9' }}>
            Swarm API is offline
          </h2>
          <p style={{ margin: '0 0 1rem' }}>
            The dashboard only appears after <code style={{ color: '#facc15' }}>/api/stats</code> returns JSON.
            Firebase Hosting serves the UI only; your swarm process must be running and reachable from this browser.
          </p>
          <ul style={{ margin: '0 0 1rem', paddingLeft: '1.25rem' }}>
            <li>
              Run the swarm locally: <code style={{ color: '#94a3b8' }}>npm run dev</code> in the repo root (API on port{' '}
              <strong>3001</strong>).
            </li>
            <li>
              From the internet, tunnel 3001 with ngrok and paste the <strong>https</strong> base URL above (no path, no trailing slash).
            </li>
            <li>
              For a stable production URL, set <code style={{ color: '#94a3b8' }}>VITE_API_BASE_URL</code> when building the UI, then redeploy.
            </li>
          </ul>
          {fetchError && (
            <p
              style={{
                margin: 0,
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: 'rgba(244,63,94,0.08)',
                border: '1px solid rgba(244,63,94,0.25)',
                color: '#fda4af',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                wordBreak: 'break-word',
              }}
            >
              {fetchError}
            </p>
          )}
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
                <div className="metric-row">
                  <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Clock size={12} /> Last Action
                  </span>
                  <span className="metric-value text-cyan" style={{ fontSize: '0.8rem' }}>{timeAgo(data.scout.lastActionAt)}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Blocks size={12} /> Block
                  </span>
                  <span className="metric-value" style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                    {data.scout.lastBlockNumber ? `#${data.scout.lastBlockNumber.toLocaleString()}` : '--'}
                  </span>
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
                <div className="metric-row">
                  <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Clock size={12} /> Last Action
                  </span>
                  <span className="metric-value text-cyan" style={{ fontSize: '0.8rem' }}>{timeAgo(data.risk.lastActionAt)}</span>
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
                <div className="metric-row">
                  <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Clock size={12} /> Last Action
                  </span>
                  <span className="metric-value text-cyan" style={{ fontSize: '0.8rem' }}>{timeAgo(data.executor.lastActionAt)}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Blocks size={12} /> Block
                  </span>
                  <span className="metric-value" style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                    {data.executor.lastBlockNumber ? `#${data.executor.lastBlockNumber.toLocaleString()}` : '--'}
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

          {/* SwarmFund — My Vault (wallet-connected) */}
          <MyVault />

          {/* P&L and Trade History Section */}
          <div style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Activity size={20} className="text-cyan" /> Trade History
              </h2>
              
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem 1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span className="text-gray" style={{ fontSize: '0.85rem' }}>Rolling P&L</span>
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
