import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, websocketUrl } from './lib/api';
import { analyzeTelemetry } from './lib/diagnostics';
import { previewSamples } from './lib/preview';
import { generateShowcaseSession } from './lib/showcase';
import { previewPingPongIndex } from './lib/instrumentMath';
import type { DemoScenario, DrivingSession, TelemetrySample } from './lib/types';
import { InstrumentDial, AuxDial, Oscilloscope, RevLights, ThrottleStack } from './components/Instrument';

const preview = previewSamples();
// Pages uses a browser-only showcase; local Vite development still uses FastAPI.
const showcase = import.meta.env.MODE === 'showcase';
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
  // Most WebSocket events contain a single chronological sample; avoid sorting the entire history.
  if (a.length && b.length === 1) {
    const next = b[0];
    const last = a[a.length - 1];
    if (next.elapsed_s > last.elapsed_s) return [...a, next];
    if (next.elapsed_s === last.elapsed_s) return [...a.slice(0, -1), next];
  }
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
  const [online, setOnline] = useState(showcase);
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
  const [previewFrame, setPreviewFrame] = useState(0);
  const [preset, setPreset] = useState<1 | 2 | 3 | 4>(1);
  const [showcaseArchive, setShowcaseArchive] = useState<Record<string, TelemetrySample[]>>({});
  const [showcaseRun, setShowcaseRun] = useState<{ id: string; records: TelemetrySample[]; startedAt: number } | null>(null);

  const refreshSessions = useCallback(async () => {
    if (showcase) return; // No network requests on GitHub Pages.
    const list = await api.sessions();
    setSessions(list);
    setSelectedId(existing => existing || list[0]?.session_id || null);
  }, []);

  // Health is separate from WebSocket status: API can be healthy with no selected session.
  useEffect(() => {
    if (showcase) return;
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
    if (showcase || !selectedId || !online) return;
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
  }, [selectedId, refreshSessions, online]);

  // Public showcase: stream synthetic samples in-browser at 10 Hz, with no backend,
  // database, microphone, camera, car interface or outgoing telemetry requests.
  useEffect(() => {
    if (!showcase || !showcaseRun) return;
    const run = showcaseRun;
    const interval = window.setInterval(() => {
      const elapsedMs = Math.max(0, performance.now() - run.startedAt);
      const count = Math.min(run.records.length, Math.floor(elapsedMs / 100) + 1);
      if (selectedId === run.id) setSamples(run.records.slice(0, count));
      if (count >= run.records.length) {
        setShowcaseRun(current => current?.id === run.id ? null : current);
        setDemoStatus('complete');
        setSessions(current => current.map(item => item.session_id === run.id ? { ...item, sample_count: count } : item));
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [showcaseRun, selectedId]);

  // Instrument-attract mode: cycle a clearly marked synthetic trace even with no API.
  useEffect(() => {
    if (online && selectedId && samples.length > 0) return;
    // The 18s trace reverses smoothly at its boundaries instead of jumping to frame 0.
    const cycle = 2 * (preview.length - 1);
    const interval = window.setInterval(() => setPreviewFrame(f => (f + 1) % cycle), 100);
    return () => window.clearInterval(interval);
  }, [online, selectedId, samples.length > 0]);

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
    if (showcase) {
      const id = `browser-${Date.now()}`;
      const records = generateShowcaseSession(scenario, duration, id);
      const label = `${scenario.replaceAll('_', ' ').toUpperCase()} / ${duration}s · browser demo`;
      setShowcaseArchive(current => ({ ...current, [id]: records }));
      setSessions(current => [{ session_id: id, label, source: 'simulation', created_at: new Date().toISOString(), sample_count: 0 }, ...current]);
      setSelectedId(id);
      setSamples(records.slice(0, 1));
      setCursor(0);
      setFollowLive(true);
      setPlaying(false);
      setDemoStatus('running');
      setError('');
      setShowcaseRun({ id, records, startedAt: performance.now() });
      return;
    }
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
    if (showcase) {
      if (showcaseRun) {
        // Stop the active run even if a different session is being viewed.
        const elapsedMs = Math.max(0, performance.now() - showcaseRun.startedAt);
        const count = Math.min(showcaseRun.records.length, Math.floor(elapsedMs / 100) + 1);
        const committed = showcaseRun.records.slice(0, count);
        setShowcaseArchive(current => ({ ...current, [showcaseRun.id]: committed }));
        setSessions(current => current.map(item => item.session_id === showcaseRun.id ? { ...item, sample_count: count } : item));
        if (selectedId === showcaseRun.id) setSamples(committed);
      }
      setShowcaseRun(null);
      setDemoStatus('stopped');
      return;
    }
    try { await api.stopDemo(selectedId); setDemoStatus('stopping'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not stop demo'); }
  }

  function chooseSession(id: string) {
    if (showcase) {
      const history = showcaseArchive[id] ?? [];
      setSamples(history);
      setCursor(Math.max(0, history.length - 1));
    }
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

  // While API history is loading or a new run has no data yet, show clearly labelled preview data.
  const offline = !selectedId || samples.length === 0 || (!showcase && !online);
  const displaySamples = offline ? preview : samples;
  const shownIndex = offline ? previewPingPongIndex(previewFrame, preview.length) : followLive ? displaySamples.length - 1 : Math.min(cursor, displaySamples.length - 1);
  const sample = shownIndex >= 0 ? displaySamples[shownIndex] : null;
  const plotted = useMemo(() => displaySamples.slice(0, shownIndex + 1), [displaySamples, shownIndex]);
  const events = useMemo(() => analyzeTelemetry(plotted), [plotted]);
  const selectedSession = sessions.find(s => s.session_id === selectedId);
  const hottest = sample ? sample.coolant_temp_c >= 105 : false;
  const isRunning = showcase ? showcaseRun !== null : demoStatus === 'running' || demoStatus === 'stopping';
  const latestTime = displaySamples.at(-1)?.elapsed_s ?? 0;
  const currentTime = sample?.elapsed_s ?? 0;
  // Peak indicators only include measurements up to the replay cursor, not future samples.
  const maxSpeed = plotted.reduce((m, s) => Math.max(m, s.vehicle_speed_kph), 0);
  const maxRpm = plotted.reduce((m, s) => Math.max(m, s.engine_rpm), 0);

  const active = sample ?? preview[0];
  const currentSource = offline ? 'DEMONSTRATION / LOOP' : showcase ? (followLive ? 'BROWSER SYNTHETIC / LIVE' : 'BROWSER SYNTHETIC / REPLAY') : followLive ? 'SIMULATION / LIVE' : 'RECORDED / PLAYBACK';
  const maxCoolant = plotted.reduce((m, s) => Math.max(m, s.coolant_temp_c), 0);
  const alertCount = events.length;
  const presetNames = ['DRIVE', 'THERMAL', 'TRACE', 'LOGBOOK'] as const;

  return <div className="q50-app">
    <div className="dash-width">
      {showcase && <div className="showcase-banner">
        <span><b>PUBLIC SHOWCASE</b> · Synthetic telemetry generated entirely in this browser · Not connected to a car</span>
        <span className="showcase-links"><a href="https://github.com/Aram-az/Q50-Digital-Twin">SOURCE CODE ↗</a><a href="https://github.com/Aram-az/Q50-Digital-Twin/tree/main/native-app">IN-CAR ANDROID APP ↗</a></span>
      </div>}
      <header className="masthead">
        <div className="identity">
          <div className="identity-slash" aria-hidden="true"><span/><span/><span/></div>
          <div className="identity-logotype"><strong>Q50</strong><span>RED SPORT <b>400</b></span></div>
          <div className="identity-caption">DIGITAL TWIN <i>//</i> TELEMETRY INSTRUMENT</div>
        </div>
        <div className="masthead-right">
          <span className="machine-id">2017 / VR30DDTT / STAGE 2 INSPIRED</span>
          <span className={`link-indicator ${online ? 'linked':'unlinked'}`}><i/>{showcase ? 'BROWSER SHOWCASE' : online ? 'BACKEND ONLINE' : 'LOCAL PREVIEW'}</span>
          <span className="edition-plate">BUILD <b>06</b> <span>/</span> {showcase ? 'WEB DEMO' : 'LOCAL'}</span>
        </div>
      </header>

      {error && <div className="system-error" role="alert"><strong>SYS/ERROR</strong><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

      <section className="cluster-housing" aria-label="Animated Q50 engine and road-speed instruments">
        <div className="case-screw case-screw--tl" aria-hidden="true"/><div className="case-screw case-screw--tr" aria-hidden="true"/>
        <div className="cluster-engraving"><span>INSTRUMENT CLUSTER <b>/</b> 001</span><span className="engraving-center">Q50 DIGITAL TWIN <b>•</b> VIRTUAL VEHICLE</span><span>UNITS <b>METRIC</b></span></div>
        <RevLights rpm={active.engine_rpm}/>
        <div className="big-dials">
          <InstrumentDial label="ENGINE SPEED" kind="rpm" value={active.engine_rpm} max={7000} step={1000} display={(active.engine_rpm/1000).toFixed(2)} units="×1000 RPM" detail="SYNTHETIC POWERTRAIN" />
          <div className="cluster-center">
            <div className="center-hatch"><span>Q</span><strong>50</strong><small>R/S 400</small></div>
            <div className="center-data">
              <div className="center-data-caption">VEHICLE MODE</div>
              <div className="center-data-main">{isRunning ? 'SIM RUN' : offline ? 'DEMO' : playing ? 'REPLAY' : 'STANDBY'}</div>
              <div className="center-data-sub">{formatClock(currentTime)} <span>/</span> {formatClock(latestTime)}</div>
            </div>
            <ThrottleStack value={active.throttle_pct}/>
            <div className="center-status"><span className={online ? 'light-ok' : 'light-demo'}/> {showcase ? 'LOCAL SYNTHETIC STREAM' : offline ? (online && selectedId ? 'AWAITING LIVE SAMPLES' : 'LOCAL GENERATED DATA') : socketConnected ? 'TELEMETRY LINK ACTIVE' : 'LINK CONNECTING'}</div>
          </div>
          <InstrumentDial label="GROUND SPEED" kind="speed" value={active.vehicle_speed_kph} max={240} step={40} display={active.vehicle_speed_kph.toFixed(0)} units="km/h" detail="CALIBRATED UI SCALE / DEMO" />
        </div>
        <div className="cluster-ledge">
          <div>DATA <b>{currentSource}</b></div>
          <div><span className="little-led"/> SYNTHETIC INPUT · NO ECU ACCESS</div>
          <div>DISPLAY RATE <b>10 Hz SIMULATION</b></div>
        </div>
        <div className="case-screw case-screw--bl" aria-hidden="true"/><div className="case-screw case-screw--br" aria-hidden="true"/>
      </section>

      <div className="deck-section-title"><span className="index-label">/ 02</span><span>MULTI-FUNCTION DISPLAY</span><i/> <span className="deck-note">SELECT A PRESET</span></div>
      <section className="mfd-housing" aria-label="Multi-function telemetry display">
        <header className="mfd-toolbar">
          <div className="mfd-title"><strong>MFD</strong><span>{showcase ? 'BROWSER SIMULATION / ENGINEERING EDITION' : 'LIVE DATA / ENGINEERING EDITION'}</span></div>
          <nav className="preset-selector" aria-label="Display preset">
            {presetNames.map((name,index) => <button type="button" key={name} className={preset===index+1 ? 'preset-button active':''}
              onClick={()=>setPreset((index+1) as 1|2|3|4)} aria-pressed={preset===index+1}>
              <span>{String(index+1).padStart(2,'0')}</span>{name}
            </button>)}
          </nav>
          <div className="mfd-head-status"><i className={isRunning ? 'blink':''}/> {isRunning ? 'REC' : offline ? 'PREVIEW' : 'MONITOR'}</div>
        </header>
        <div className="mfd-content" key={preset}>
          {preset===1 && <div className="aux-grid">
            <AuxDial label="COOLANT" min={40} max={130} value={active.coolant_temp_c} unit="°C" warning={hottest} description="DEMO WARNING / 105°C" />
            <AuxDial label="INTAKE AIR" min={0} max={100} value={active.intake_temp_c} unit="°C" description="SIMULATED INLET TEMP" />
            <AuxDial label="THROTTLE" min={0} max={100} value={active.throttle_pct} unit="%" description="DEMAND SIGNAL" />
            <AuxDial label="PEAK RPM" min={0} max={7000} value={maxRpm} unit="RPM" description="FULL SESSION PEAK" />
            <AuxDial label="MAX SPEED" min={0} max={240} value={maxSpeed} unit="km/h" description="FULL SESSION PEAK" />
            <AuxDial label="PEAK COOLANT" min={40} max={130} value={maxCoolant} unit="°C" warning={maxCoolant>=105} description="FULL SESSION PEAK" />
          </div>}
          {preset===2 && <div className="thermal-preset">
            <div className="trace-column"><Oscilloscope samples={plotted} field="coolant_temp_c" label="COOLANT TEMPERATURE" unit="°C" color="#efaa69" />
              <div className="thermal-under"><span>105°C <b>WARNING</b></span><span>115°C <b>CRITICAL</b></span><span>DEMO ONLY</span></div></div>
            <div className="thermal-sidebar"><AuxDial label="COOLANT" min={40} max={130} value={active.coolant_temp_c} unit="°C" warning={hottest}/>
              <div className={`thermal-warning ${hottest ? 'thermal-warning--hot':''}`}><i/>{hottest ? 'THERMAL ALERT' : 'THERMAL NOMINAL'}<small>Illustrative thresholds, not Q50 limits</small></div>
              <div className="thermal-readout"><span>INTAKE</span><b>{active.intake_temp_c.toFixed(1)}°C</b></div></div>
          </div>}
          {preset===3 && <div className="trace-preset">
            <Oscilloscope samples={plotted} field="engine_rpm" label="ENGINE RPM" unit="rpm" color="#e9e8de"/>
            <Oscilloscope samples={plotted} field="vehicle_speed_kph" label="ROAD SPEED" unit="km/h" color="#e64f42" />
            <div className="trace-footer"><span>CAPTURE <b>{displaySamples.length} SAMPLES</b></span><span>SOURCE <b>{offline?'LOCAL PREVIEW':showcase?'BROWSER SYNTHETIC':'BACKEND RECORD'}</b></span><span>CURSOR <b>{formatClock(currentTime)}</b></span></div>
          </div>}
          {preset===4 && <div className="log-preset">
            <div className="log-column"><div className="log-title"><span>01 / SESSION ARCHIVE</span><button type="button" onClick={() => void refreshSessions().catch(e => setError(String(e)))} disabled={!online||showcase}>{showcase ? 'LOCAL ARCHIVE' : 'REFRESH ↻'}</button></div>
              {sessions.length===0 ? <p className="log-empty">NO SAVED DRIVES. START A SYNTHETIC SESSION BELOW TO RECORD A LOG.</p> : <div className="log-scroll">
                {sessions.slice(0,25).map(session=><button type="button" key={session.session_id} className={`log-entry ${selectedId===session.session_id?'selected':''}`} onClick={()=>chooseSession(session.session_id)}>
                  <span className="log-entry-icon">▣</span><span className="log-entry-label"><strong>{session.label}</strong><small>{session.session_id}</small></span><span className="log-entry-count">{session.sample_count}<small>PTS</small></span>
                </button>)}
              </div>}</div>
            <div className="log-column"><div className="log-title"><span>02 / DIAGNOSTIC BUFFER</span><strong className={alertCount ? 'alert-number hot':''}>{alertCount.toString().padStart(2,'0')}</strong></div>
              {events.length===0 ? <p className="log-empty">NO THRESHOLD EVENTS IN THE CURRENT VIEW. SELECT AN OVERHEATING OR SENSOR-DROPOUT SCENARIO.</p> : <div className="log-scroll">
                {events.slice(0,20).map(e=><div className={`log-event ${e.severity}`} key={e.id}><div><b>{e.label}</b><small>{e.description}</small></div><time>{e.elapsed_s.toFixed(1)}s</time></div>)}
              </div>}</div>
          </div>}
        </div>
        <footer className="mfd-footer"><span>PRESET <b>{String(preset).padStart(2,'0')} / {presetNames[preset-1]}</b></span><span>{offline?'DEMO GENERATOR':'SIMULATED SESSION'} <b>•</b> {displaySamples.length} PTS</span><button type="button" onClick={()=>setPreset(preset===4?1:((preset+1) as 1|2|3|4))}>NEXT DISPLAY ↗</button></footer>
      </section>

      <div className="deck-section-title deck-section-title--lower"><span className="index-label">/ 03</span><span>RUN CONTROL / DATA TRANSPORT</span><i/><span className="deck-note">{showcase ? 'PUBLIC OFFLINE DEMO' : 'LOCAL DEVELOPMENT ONLY'}</span></div>
      <section className="control-rack" aria-label="Simulator and playback controls">
        <div className="control-block simulator-block">
          <div className="control-head">DRIVE SIMULATOR <span className="control-subhead">NO CONNECTION TO VEHICLE</span></div>
          <div className="selector-row">
            <label>SCENARIO<select aria-label="Driving scenario" value={scenario} onChange={event=>setScenario(event.target.value as DemoScenario)}>{scenarioOptions.map(s=><option key={s.value} value={s.value}>{s.title}</option>)}</select></label>
            <label>RUN LENGTH<select aria-label="Duration" value={duration} onChange={e=>setDuration(Number(e.target.value))}><option value={15}>15 sec</option><option value={30}>30 sec</option><option value={60}>60 sec</option></select></label>
          </div>
          <div className="ignition-controls"><button className="ignition-button" type="button" onClick={()=>void startDemo()} disabled={(!online&&!showcase)||busy||isRunning}><span className="ignition-ring"><i/></span><span><b>{busy?'INITIALIZING':'START SIMULATION'}</b><small>VIRTUAL IGNITION</small></span></button>
            <button className="stop-button" type="button" onClick={()=>void stopDemo()} disabled={!isRunning||!selectedId}>■ STOP</button></div>
          <div className="run-status"><i className={isRunning?'blink':''}/>{showcase ? (isRunning ? 'BROWSER-ONLY SYNTHETIC STREAM ACTIVE' : 'BROWSER DEMO READY / NO SERVER REQUIRED') : !online?'CONNECT FASTAPI TO RUN':isRunning?'SYNTHETIC STREAM ACTIVE':demoStatus?`SIMULATOR / ${demoStatus.toUpperCase()}`:'SIMULATOR ARMED / READY'}</div>
        </div>
        <div className="control-block transport-block">
          <div className="control-head">SESSION TRANSPORT <span className="control-subhead">TIMESTAMP-ACCURATE REPLAY</span></div>
          <div className="transport-buttons">
            <button type="button" title="Return to first sample" disabled={!selectedId} onClick={()=>{setFollowLive(false);setPlaying(false);setCursor(0);}}>↺</button>
            <button type="button" className="play-control" disabled={!selectedId||displaySamples.length<2} onClick={playing?pauseReplay:beginReplay}>{playing?'Ⅱ PAUSE':'▶ REPLAY'}</button>
            <button type="button" className={followLive?'transport-live active':'transport-live'} disabled={!selectedId} onClick={()=>{setFollowLive(true);setPlaying(false);}}>● LIVE</button>
            <label>RATE<select aria-label="Replay speed" value={speed} onChange={e=>{setPlaying(false);setSpeed(Number(e.target.value))}}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
          </div>
          <div className="tape-deck"><span>{formatClock(currentTime)}</span><input aria-label="Replay position" type="range" min="0" max={Math.max(0,displaySamples.length-1)} value={Math.max(0,shownIndex)} disabled={!selectedId||displaySamples.length===0} onChange={e=>{setPlaying(false);setFollowLive(false);setCursor(Number(e.target.value))}}/><span>{formatClock(latestTime)}</span></div>
          <div className="tape-note">{selectedSession?.label||'BUILT-IN 18 SECOND PREVIEW'} <span> / {selectedId||'NO SESSION SELECTED'}</span></div>
        </div>
      </section>
      <footer className="page-footer"><span><b>Q50 // DT05</b> - INDEPENDENT TELEMETRY DESIGN STUDY</span><span>R35 PERFORMANCE DISPLAY-INSPIRED · ORIGINAL INTERFACE</span><span className="safety-foot">{showcase ? 'PUBLIC SITE: BROWSER-GENERATED DATA ONLY. IN-CAR APP IS A SEPARATE MODULE.' : 'SIMULATION ONLY. NOT OEM GAUGES OR VALIDATED VEHICLE DIAGNOSTICS.'}</span></footer>
    </div>
  </div>;
}
