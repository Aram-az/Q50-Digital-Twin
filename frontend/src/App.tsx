import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, websocketUrl } from './lib/api';
import { analyzeTelemetry } from './lib/diagnostics';
import { previewSamples } from './lib/preview';
import type { DemoScenario, DrivingSession, TelemetrySample } from './lib/types';
import { MiniGauge, TelemetryChart, VehicleGraphic } from './components/Visuals';

const preview = previewSamples();
const scenarioOptions: { value: DemoScenario; title: string }[] = [
  { value: 'mixed', title: 'Mixed driving' },
  { value: 'acceleration', title: 'Acceleration' },
  { value: 'cruise', title: 'Cruising' },
  { value: 'idle', title: 'Idle' },
  { value: 'overheat', title: 'Fault: overheating' },
  { value: 'sensor_dropout', title: 'Fault: sensor dropout' },
];

/** Merge historical fetches and live WebSocket events without duplicate samples. */
function mergeSamples(a: TelemetrySample[], b: TelemetrySample[]): TelemetrySample[] {
  const map = new Map(a.map(s => [s.elapsed_s, s]));
  b.forEach(s => map.set(s.elapsed_s, s));
  return [...map.values()].sort((x, y) => x.elapsed_s - y.elapsed_s);
}

function findIndexAtTime(samples: TelemetrySample[], target: number): number {
  let low = 0, high = samples.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (samples[mid].elapsed_s <= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

function formatClock(secs: number) {
  return `${Math.floor(secs / 60).toString().padStart(2, '0')}:${Math.floor(secs % 60).toString().padStart(2, '0')}`;
}

export default function App() {
  const [online, setOnline] = useState(false);
  const [sessions, setSessions] = useState<DrivingSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [samples, setSamples] = useState<TelemetrySample[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [scenario, setScenario] = useState<DemoScenario>('mixed');
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoStatus, setDemoStatus] = useState('');
  const [followLive, setFollowLive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cursor, setCursor] = useState(0);
  const [playbackRun, setPlaybackRun] = useState(0);

  const refreshSessions = useCallback(async () => {
    const list = await api.sessions();
    setSessions(list);
    setSelectedId(existing => existing || list[0]?.session_id || null);
  }, []);

  // Health is separate from WebSocket status: API can be healthy with no selected session.
  useEffect(() => {
    let alive = true;
    const check = () => {
      api.health().then(() => { if (alive) setOnline(true); }).catch(() => { if (alive) setOnline(false); });
      api.sessions().then(list => {
        if (!alive) return;
        setSessions(list);
        setSelectedId(existing => existing || list[0]?.session_id || null);
      }).catch(() => {});
    };
    check();
    const interval = window.setInterval(check, 8000);
    return () => { alive = false; window.clearInterval(interval); };
  }, []);

  // On selection, load existing history and subscribe to new committed telemetry.
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    let retry: number | undefined;
    let ws: WebSocket | undefined;
    setSocketConnected(false);
    setSamples([]);
    setPlaying(false);
    setCursor(0);

    async function reloadHistory() {
      try {
        const history = await api.samples(selectedId!);
        if (!active) return;
        setSamples(existing => mergeSamples(existing, history));
        setCursor(existing => existing === 0 ? Math.max(0, history.length - 1) : existing);
      } catch (err) { if (active) setError(err instanceof Error ? err.message : 'History load failed'); }
    }
    const connect = () => {
      if (!active) return;
      ws = new WebSocket(websocketUrl(selectedId));
      ws.onopen = () => { if (active) setSocketConnected(true); };
      ws.onmessage = event => {
        if (!active) return;
        try {
          const message = JSON.parse(event.data as string) as {
            type: string; sample?: TelemetrySample; samples?: TelemetrySample[]; status?: string;
          };
          if (message.type === 'connected') { void reloadHistory(); }
          if (message.type === 'telemetry' && message.sample) setSamples(previous => mergeSamples(previous, [message.sample!]));
          if (message.type === 'telemetry_batch' && message.samples) setSamples(previous => mergeSamples(previous, message.samples!));
          if (message.type === 'demo_status') {
            setDemoStatus(message.status || '');
            void refreshSessions().catch(() => {});
            void reloadHistory();
          }
        } catch { setError('Unexpected WebSocket event. Check the backend.'); }
      };
      ws.onclose = () => {
        if (!active) return;
        setSocketConnected(false);
        retry = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => { ws?.close(); };
    };
    void reloadHistory();
    connect();
    return () => { active = false; if (retry) clearTimeout(retry); ws?.close(); };
  }, [selectedId, refreshSessions]);

  // Replay is based on simulation timestamps, not the number of samples. This
  // preserves pauses and missing-data gaps when viewing dropout scenarios.
  useEffect(() => {
    if (!playing || samples.length < 2 || followLive) return;
    let frame = 0;
    const startTime = performance.now();
    const baseTime = samples[Math.min(cursor, samples.length - 1)].elapsed_s;
    const lastTime = samples[samples.length - 1].elapsed_s;
    const tick = (now: number) => {
      const target = baseTime + (now - startTime) / 1000 * speed;
      setCursor(findIndexAtTime(samples, Math.min(lastTime, target)));
      if (target >= lastTime) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // playbackRun changes only when play is explicitly started, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, playbackRun, speed, followLive, samples]);

  async function startDemo() {
    setBusy(true);
    setError('');
    try {
      const response = await api.startDemo(scenario, duration);
      setSelectedId(response.session_id);
      setFollowLive(true);
      setPlaying(false);
      setCursor(0);
      setDemoStatus('running');
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start simulation');
    } finally { setBusy(false); }
  }

  async function stopDemo() {
    if (!selectedId) return;
    try { await api.stopDemo(selectedId); setDemoStatus('stopping'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not stop demo'); }
  }

  function chooseSession(id: string) {
    setFollowLive(false);
    setPlaying(false);
    setSelectedId(id);
    setDemoStatus('');
  }

  function beginReplay() {
    if (displaySamples.length < 2 || !selectedId) return;
    setFollowLive(false);
    if (cursor >= displaySamples.length - 1) setCursor(0);
    setPlaybackRun(v => v + 1);
    setPlaying(true);
  }

  function pauseReplay() { setPlaying(false); }

  const offline = !selectedId;
  const displaySamples = offline ? preview : samples;
  const shownIndex = followLive ? displaySamples.length - 1 : Math.min(cursor, displaySamples.length - 1);
  const sample = shownIndex >= 0 ? displaySamples[shownIndex] : null;
  const plotted = displaySamples.slice(0, shownIndex + 1);
  const events = useMemo(() => analyzeTelemetry(plotted), [plotted]);
  const selectedSession = sessions.find(s => s.session_id === selectedId);
  const hottest = sample ? sample.coolant_temp_c >= 105 : false;
  const isRunning = demoStatus === 'running' || demoStatus === 'stopping';
  const latestTime = displaySamples.at(-1)?.elapsed_s ?? 0;
  const currentTime = sample?.elapsed_s ?? 0;
  const maxSpeed = displaySamples.reduce((m, s) => Math.max(m, s.vehicle_speed_kph), 0);
  const maxRpm = displaySamples.reduce((m, s) => Math.max(m, s.engine_rpm), 0);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol">Q<span>50</span></div><div className="brand-caption">DIGITAL TWIN <span className="brand-dot">●</span></div></div>
      <div className="aside-section">WORKSPACE</div>
      <nav className="nav-links" aria-label="Main navigation">
        <a className="active" href="#overview"><span>◫</span> Overview</a>
        <a href="#telemetry"><span>⌁</span> Telemetry</a>
        <a href="#diagnostics"><span>◇</span> Diagnostics</a>
        <a href="#sessions"><span>▤</span> Session history</a>
      </nav>
      <div className="aside-section sidebar-divider">VEHICLE PROFILE</div>
      <div className="vehicle-profile"><span className="vehicle-initial">Q</span><div><strong>Infiniti Q50</strong><small>2017 · Red Sport 400</small><small>Stage 2 · Project inspiration</small></div></div>
      <div className="sidebar-bottom">
        <span className="status-led" /> LOCAL DEVELOPMENT
        <p>Simulation-only platform. No ECU commands or live vehicle integration.</p>
        <span className="sidebar-version">BUILD 0.4.0 / PHASE 4</span>
      </div>
    </aside>

    <main className="content" id="overview">
      <header className="topbar">
        <div className="breadcrumb">PROJECTS <span>/</span> Q50 DIGITAL TWIN <span>/</span> <strong>OVERVIEW</strong></div>
        <div className="topbar-right"><span className={`connection ${online ? 'good' : 'bad'}`}><i /> API {online ? 'CONNECTED' : 'OFFLINE'}</span><span className="mode-tag">SYNTHETIC DATA ONLY</span></div>
      </header>

      <div className="main-area">
        <section className="page-heading"><div><span className="eyebrow">AUTOMOTIVE ENGINEERING / COMMAND CENTER</span><h1>Vehicle <em>Overview.</em></h1><p>Real-time telemetry, diagnostics and session analysis — from a virtual Q50 powertrain.</p></div><div className="header-meta"><span>PLATFORM STATUS</span><strong>{offline ? 'PREVIEW MODE' : socketConnected ? 'STREAM LINK READY' : 'RECONNECTING'}</strong><small>{selectedSession?.label || 'Offline sample dataset'}</small></div></section>

        {error && <div className="error-banner"><strong>Action required:</strong> {error}<button type="button" onClick={() => setError('')} aria-label="Dismiss error">✕</button></div>}
        {!online && <div className="info-banner"><strong>Preview only.</strong> The FastAPI server is not reachable. Charts show clearly labeled built-in synthetic sample data. Start your backend on port 8000 to run or load sessions.</div>}

        <section className="command-card" aria-label="Simulation controls">
          <div className="command-caption"><span className="red-led" /> SIMULATION CONTROLS <small>LOCAL / READ-ONLY</small></div>
          <div className="command-controls">
            <label>DRIVING SCENARIO<select aria-label="Driving scenario" value={scenario} onChange={event => setScenario(event.target.value as DemoScenario)}>{scenarioOptions.map(s => <option value={s.value} key={s.value}>{s.title}</option>)}</select></label>
            <label>DURATION<select aria-label="Duration" value={duration} onChange={event => setDuration(Number(event.target.value))}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option></select></label>
            <button type="button" className="primary-button" disabled={!online || busy} onClick={() => void startDemo()}>{busy ? 'STARTING…' : '▶ START NEW SIMULATION'}</button>
            <button type="button" className="ghost-button" disabled={!isRunning || !selectedId} onClick={() => void stopDemo()}>■ STOP</button>
          </div>
          <div className="command-foot"><span className="pulse-led" /> {isRunning ? 'SIMULATOR RUNNING' : demoStatus ? `SIMULATOR ${demoStatus.toUpperCase()}` : 'READY FOR VIRTUAL DRIVING'} <span className="command-foot-right">10 Hz sample rate · Independent Python model</span></div>
        </section>

        <section className="metric-grid" aria-label="Current telemetry">
          <div className="metric-card"><div className="metric-label">VEHICLE SPEED <span>↗</span></div><div className="metric-big">{sample ? sample.vehicle_speed_kph.toFixed(0) : '—'}<span>km/h</span></div><div className="metric-foot"><span className="metric-cyan">●</span> VIRTUAL SPEED SIGNAL</div></div>
          <div className="metric-card"><div className="metric-label">ENGINE SPEED <span>⌁</span></div><div className="metric-big">{sample ? Math.round(sample.engine_rpm).toLocaleString() : '—'}<span>RPM</span></div><div className="metric-foot"><span className="metric-amber">●</span> SIMULATED POWERTRAIN</div></div>
          <div className="metric-card"><div className="metric-label">COOLANT TEMP <span>◉</span></div><div className={`metric-big ${hottest ? 'hot-value' : ''}`}>{sample ? sample.coolant_temp_c.toFixed(1) : '—'}<span>°C</span></div><div className="metric-foot">{hottest ? <span className="metric-red">▲ THRESHOLD EXCEEDED</span> : <span className="metric-green">● BELOW DEMO THRESHOLD</span>}</div></div>
          <div className="metric-card"><div className="metric-label">INTAKE AIR TEMP <span>◌</span></div><div className="metric-big">{sample ? sample.intake_temp_c.toFixed(1) : '—'}<span>°C</span></div><div className="metric-foot">SYNTHETIC INTAKE READING</div></div>
        </section>

        <section className="primary-grid" id="telemetry">
          <article className="panel vehicle-panel"><div className="panel-title-row"><div><span className="eyebrow">VEHICLE DIGITAL TWIN</span><h2>2017 Q50 Red Sport</h2></div><span className="subtle-pill">{offline ? 'OFFLINE SAMPLE' : 'VIRTUAL VEHICLE'}</span></div><div className="vehicle-stage"><div className="stage-annotation top-left">VR30DDTT <span>INSPIRATION ONLY</span></div><div className="stage-annotation top-right">POWERTRAIN <span>SYNTHETIC</span></div><VehicleGraphic hot={hottest} /><div className="stage-annotation bottom-left">TELEMETRY SOURCE <span>{offline ? 'BUILT-IN PREVIEW' : 'API / SIMULATION'}</span></div></div><div className="vehicle-panel-bottom"><div><span>DATA QUALITY</span><strong>● {sample ? 'VALID' : 'NO DATA'}</strong></div><div><span>SESSION SAMPLES</span><strong>{displaySamples.length.toLocaleString()}</strong></div><div><span>PLAYHEAD</span><strong>{formatClock(currentTime)}</strong></div></div></article>
          <article className="panel powertrain-panel"><div className="panel-title-row"><div><span className="eyebrow">ENGINE TELEMETRY</span><h2>Powertrain Status</h2></div><span className="subtle-pill">LIVE VALUES</span></div><div className="gauge-layout"><div><MiniGauge value={sample?.throttle_pct || 0} maximum={100} color="#55d6d5" unit="%" /><span>THROTTLE</span></div><div><MiniGauge value={sample?.engine_rpm || 0} maximum={6500} color="#f1b466" unit="RPM" /><span>RPM SCALE</span></div></div><div className="powertrain-info"><div><span>THROTTLE POSITION</span><strong>{sample?.throttle_pct.toFixed(1) ?? '—'} %</strong></div><div><span>ENGINE RPM PEAK</span><strong>{Math.round(maxRpm).toLocaleString()} rpm</strong></div><div><span>MAX RECORDED SPEED</span><strong>{maxSpeed.toFixed(1)} km/h</strong></div></div><div className="panel-small-note">RPM gauge represents simulated engine speed, not a calibrated engine-load measurement.</div></article>
        </section>

        <section className="secondary-grid">
          <article className="panel chart-panel"><div className="panel-title-row"><div><span className="eyebrow">SIGNAL HISTORY</span><h2>Engine & Speed Trace</h2></div><div className="legend"><span><i style={{background:'#56d9d8'}} /> RPM</span><span><i style={{background:'#f4b96e'}} /> SPEED</span></div></div><TelemetryChart samples={plotted} field="engine_rpm" color="#56d9d8" secondaryField="vehicle_speed_kph" secondaryColor="#f4b96e" /><div className="panel-small-note">Each series is independently normalized to show its trend; not a shared numerical axis. Hover for values.</div></article>
          <article className="panel chart-panel"><div className="panel-title-row"><div><span className="eyebrow">THERMAL MONITORING</span><h2>Coolant Temperature</h2></div><span className="subtle-pill">°C</span></div><TelemetryChart samples={plotted} field="coolant_temp_c" color="#f4b96e" /><div className="thermal-bar"><span>DEMO WARNING LIMIT</span><strong>105 °C</strong></div><div className="panel-small-note">Thresholds are illustrative, not approved for vehicle diagnostics.</div></article>
        </section>

        <section className="panel playback-panel" id="playback"><div className="panel-title-row"><div><span className="eyebrow">SESSION TRANSPORT</span><h2>Timeline & Replay</h2></div><div className="transport-label">{followLive ? '● FOLLOWING LIVE' : playing ? '▶ REPLAYING' : '|| PAUSED / HISTORY'}</div></div><div className="playback-controls"><button type="button" onClick={() => { setFollowLive(false); setPlaying(false); setCursor(0); }} aria-label="Rewind to beginning">↺</button><button type="button" className="transport-main" disabled={!selectedId || displaySamples.length < 2} onClick={playing ? pauseReplay : beginReplay}>{playing ? 'Ⅱ PAUSE' : '▶ REPLAY'}</button><button type="button" onClick={() => { setFollowLive(true); setPlaying(false); }} disabled={!selectedId} aria-label="Follow latest telemetry">⌁ LIVE</button><span className="timeline-value">{formatClock(currentTime)}</span><input type="range" aria-label="Replay position" min="0" max={Math.max(0, displaySamples.length - 1)} step="1" value={Math.max(0, shownIndex)} disabled={!selectedId || displaySamples.length === 0} onChange={event => { setPlaying(false); setFollowLive(false); setCursor(Number(event.target.value)); }} /><span className="timeline-value">{formatClock(latestTime)}</span><label className="speed-label">SPEED <select value={speed} onChange={e => { setPlaying(false); setSpeed(Number(e.target.value)); }}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label></div><p className="panel-small-note">Replay uses recorded simulation timestamps, including any missing-data gaps. Selecting an archived session loads stored data from the API.</p></section>

        <section className="lower-grid">
          <article className="panel" id="diagnostics"><div className="panel-title-row"><div><span className="eyebrow">FAULT MONITORING</span><h2>Diagnostic Events <span className="heading-count">{events.length}</span></h2></div><span className="subtle-pill">DEMO RULES</span></div>{events.length === 0 ? <div className="empty-state"><div className="empty-icon">◇</div><strong>No simulated faults detected</strong><p>Try the Overheating or Sensor Dropout scenario to exercise the diagnostic rules.</p></div> : <div className="events-list">{events.slice(0,6).map(e => <div className="event" key={e.id}><div className={`event-dot ${e.severity}`} /><div><strong>{e.label}</strong><p>{e.description}</p></div><time>{e.elapsed_s.toFixed(1)}s</time></div>)}</div>}<div className="panel-small-note panel-footer-note">This is a rule-based simulator demonstration, not a certified fault reader or mechanical assessment.</div></article>
          <article className="panel" id="sessions"><div className="panel-title-row"><div><span className="eyebrow">SAVED DRIVE LOGS</span><h2>Session History</h2></div><button className="text-button" type="button" onClick={() => void refreshSessions().catch(err => setError(String(err)))}>↻ REFRESH</button></div><div className="sessions-list">{sessions.length === 0 ? <div className="empty-state"><div className="empty-icon">▤</div><strong>No stored sessions yet</strong><p>Launch a simulation to record telemetry in your database.</p></div> : sessions.slice(0,8).map(session => <button key={session.session_id} type="button" className={`session-row ${session.session_id === selectedId ? 'selected' : ''}`} onClick={() => chooseSession(session.session_id)}><span className="session-icon">▤</span><span className="session-meta"><strong>{session.label}</strong><small>{session.session_id} · {session.sample_count} samples</small></span><span className="session-arrow">↗</span></button>)}</div><div className="panel-small-note panel-footer-note">Only simulated sessions are accepted by the current backend.</div></article>
        </section>
        <footer className="footer"><span>Q50 DIGITAL TWIN <b>0.4.0</b> · Engineering portfolio</span><span>NOT CONNECTED TO A VEHICLE · ALL DATA SYNTHETIC</span></footer>
      </div>
    </main>
  </div>;
}
