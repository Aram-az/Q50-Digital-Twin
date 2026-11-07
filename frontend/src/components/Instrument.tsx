import { useId, useState } from 'react';
import type { TelemetrySample } from '../lib/types';
import { clamp, polar, gaugeAngle, arcProgress } from '../lib/instrumentMath';

interface DialProps {
  label: string;
  value: number;
  max: number;
  step: number;
  display: string;
  units: string;
  kind: 'rpm' | 'speed';
  detail: string;
}

/** Fully drawn SVG instrument: ticks, graded markings and damped needle transitions. */
export function InstrumentDial({ label, value, max, step, display, units, kind, detail }: DialProps) {
  const unique = useId().replaceAll(':', '');
  const angle = gaugeAngle(value, 0, max);
  const isRpm = kind === 'rpm';
  const majorCount = Math.floor(max / step);
  const tickCount = majorCount * 5;
  const scaleLabel = isRpm ? 'x1000 r/min' : 'km/h';
  return <div className={`instrument instrument--${kind}`}>
    <svg viewBox="0 0 360 360" role="img" aria-label={`${label}: ${display} ${units}`} className="instrument-face">
      <defs>
        <radialGradient id={`well-${unique}`} cx="48%" cy="45%" r="62%">
          <stop offset="0" stopColor="#1d2022" />
          <stop offset=".64" stopColor="#0b0d0f" />
          <stop offset=".87" stopColor="#030404" />
          <stop offset="1" stopColor="#26292c" />
        </radialGradient>
        <linearGradient id={`bezel-${unique}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#51545a"/><stop offset=".16" stopColor="#0e0f10" />
          <stop offset=".62" stopColor="#5d5e60"/><stop offset=".85" stopColor="#121314"/><stop offset="1" stopColor="#38393b"/>
        </linearGradient>
        <filter id={`needle-shadow-${unique}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity=".9" />
        </filter>
      </defs>
      <circle cx="180" cy="180" r="178" fill={`url(#bezel-${unique})`} />
      <circle cx="180" cy="180" r="171.5" fill="#080909" stroke="#080808" strokeWidth="5"/>
      <circle cx="180" cy="180" r="164" fill={`url(#well-${unique})`} stroke="#35383a" strokeWidth="1" />
      <circle cx="180" cy="180" r="143" fill="none" stroke="#6b6863" strokeOpacity=".15" strokeWidth="1" />
      <circle cx="180" cy="180" r="120" fill="none" stroke="#a29b89" strokeOpacity=".14" strokeDasharray="1.5 5" />
      {isRpm && Array.from({length: 14}, (_, index) => {
        const a = 135 + (6000 / 7000) * 270 + index * ((270 * (1000 / 7000)) / 13);
        const p = polar(180, 180, 153, a);
        const q = polar(180, 180, 161, a);
        return <line key={`red-${index}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#d64335" strokeWidth="5" opacity=".9" />;
      })}
      {Array.from({ length: tickCount + 1 }, (_, index) => {
        const a = 135 + index / tickCount * 270;
        const major = index % 5 === 0;
        const p = polar(180, 180, major ? 135 : 145, a);
        const q = polar(180, 180, 155, a);
        return <line key={index} x1={p.x} y1={p.y} x2={q.x} y2={q.y}
          stroke={isRpm && index / tickCount >= 6 / 7 ? '#e25240' : major ? '#efeee8' : '#a9aaa7'}
          strokeOpacity={major ? 1 : .58} strokeWidth={major ? 2.8 : 1.15} />;
      })}
      {Array.from({length: majorCount + 1}, (_, index) => {
        const p = polar(180, 180, 113, 135 + index / majorCount * 270);
        return <text key={index} x={p.x} y={p.y + 5.5} textAnchor="middle" className="dial-tick-label">
          {isRpm ? index : index * step}
        </text>;
      })}
      <text x="180" y="85" className="dial-brand" textAnchor="middle">{label}</text>
      <text x="180" y="103" className="dial-units" textAnchor="middle">{scaleLabel}</text>
      <text x="180" y="241" className="dial-reading" textAnchor="middle">{display}</text>
      <text x="180" y="260" className="dial-reading-unit" textAnchor="middle">{units}</text>
      <text x="180" y="285" className="dial-detail" textAnchor="middle">{detail}</text>
      <g className="needle-assembly" style={{ transform: `rotate(${angle + 90}deg)`, transformBox: 'view-box', transformOrigin: '50% 50%' }} filter={`url(#needle-shadow-${unique})`}>
        <path d="M174 191 L178.5 49 L181.5 49 L186 191 Z" fill="#f04a3e" />
        <path d="M178.8 53 L179.7 179" stroke="#ffac91" strokeOpacity=".7" strokeWidth="1" />
        <path d="M178 181 L182 215 L185 183" fill="#6b2522" />
      </g>
      <circle cx="180" cy="180" r="16" fill="#101113" stroke="#53545a" strokeWidth="3.5" />
      <circle cx="180" cy="180" r="8.5" fill="#292b2f" stroke="#0a0a0a" strokeWidth="1" />
      <circle cx="175" cy="175" r="2" fill="#858588" opacity=".65" />
      <path d="M74 60 Q180 17 285 60" fill="none" stroke="#fff" strokeOpacity=".06" strokeWidth="12" strokeLinecap="round" />
    </svg>
    <span className="instrument-caption">{isRpm ? '01 / ENGINE' : '02 / VEHICLE'}</span>
  </div>;
}

interface AuxDialProps { label: string; value: number; unit: string; min: number; max: number; warning?: boolean; description?: string; }
/** Compact GT-R MFD-inspired half sweep, independent of the twin primary gauges. */
export function AuxDial({ label, value, unit, min, max, warning = false, description }: AuxDialProps) {
  const uid = useId().replaceAll(':', '');
  const center = { x: 100, y: 100 };
  const start = polar(center.x, center.y, 78, 180);
  const end = polar(center.x, center.y, 78, 360);
  // Fixed arc geometry lets CSS interpolate the fill smoothly between telemetry updates.
  const arcLength = Math.PI * 78;
  const progressLength = arcProgress(value, min, max, 78);
  return <div className={`aux-dial ${warning ? 'aux-dial--warn' : ''}`} aria-label={`${label}: ${value.toFixed(1)} ${unit}`}>
    <div className="aux-dial-top"><span>{label}</span><span className="aux-index">●</span></div>
    <svg viewBox="0 0 200 135" role="img" aria-label={`${label} gauge`}>
      <defs><linearGradient id={`auxgrad-${uid}`}><stop stopColor="#ecebe5"/><stop offset="1" stopColor="#92928c"/></linearGradient></defs>
      <path d={`M${start.x} ${start.y} A78 78 0 0 1 ${end.x} ${end.y}`} fill="none" stroke="#3b3e3c" strokeWidth="8" />
      <path d={`M${start.x} ${start.y} A78 78 0 0 1 ${end.x} ${end.y}`} fill="none"
        stroke={warning ? '#ef4a38' : `url(#auxgrad-${uid})`} strokeWidth="8" strokeLinecap="butt"
        strokeDasharray={`${progressLength} ${arcLength}`} className="aux-progress" />
      {Array.from({length: 11}, (_,i) => {
        const ang = 180 + i * 18;
        const p = polar(100,100,68,ang), q = polar(100,100,78,ang);
        return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#e3e2dc" strokeWidth={i%5===0?2.4:1} opacity={i%5===0?1:.55}/>;
      })}
      <text x="100" y="76" textAnchor="middle" className="aux-number">{Number.isFinite(value) ? value.toFixed(unit === 'RPM' || unit === 'km/h' ? 0 : 1) : '-'}</text>
      <text x="100" y="95" textAnchor="middle" className="aux-unit">{unit}</text>
      <text x="25" y="117" className="aux-min">{min}</text><text x="175" y="117" textAnchor="end" className="aux-min">{max}</text>
    </svg>
    {description && <div className="aux-foot">{description}</div>}
  </div>;
}

interface TraceProps { samples: TelemetrySample[]; field: 'engine_rpm' | 'vehicle_speed_kph' | 'coolant_temp_c' | 'intake_temp_c' | 'throttle_pct'; label: string; unit: string; color?: string; }
/** An oscilloscope-like trace with a useful pointer readout; gaps remain visible in time. */
export function Oscilloscope({ samples, field, label, unit, color = '#d9d9d3' }: TraceProps) {
  const [hover, setHover] = useState<number | null>(null);
  const recent = samples.slice(-300);
  const startT = recent[0]?.elapsed_s ?? 0;
  const endT = recent.at(-1)?.elapsed_s ?? startT + 1;
  const span = Math.max(1, endT - startT);
  const values = recent.map(s => s[field]);
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 1;
  const pad = Math.max((max - min) * .15, max === min ? 1 : .5);
  min -= pad; max += pad;
  const x = (t:number) => 18 + (t - startT) / span * 600;
  const y = (v:number) => 166 - (v - min) / (max - min) * 138;
  // Deliberately break the plotted polyline when timestamps show dropped readings.
  let path = '';
  recent.forEach((s, i) => {
    const disconnected = i === 0 || s.elapsed_s - recent[i - 1].elapsed_s > .5;
    path += `${disconnected ? 'M' : 'L'}${x(s.elapsed_s).toFixed(2)} ${y(s[field]).toFixed(2)} `;
  });
  const selected = hover === null ? recent.at(-1) : recent[hover];
  return <div className="oscilloscope">
    <div className="scope-head"><span><i className="scope-channel" style={{ backgroundColor: color }}/> {label}</span><strong>{selected ? selected[field].toFixed(1) : '-'} <small>{unit}</small></strong></div>
    <svg viewBox="0 0 636 210" role="img" aria-label={`${label} time series`} onMouseLeave={() => setHover(null)}>
      {Array.from({length: 9}, (_,i) => <line key={`v${i}`} x1={18 + i*75} y1="10" x2={18 + i*75} y2="172" stroke="#343a38" strokeWidth="1" opacity=".6"/>)}
      {Array.from({length: 5}, (_,i) => <line key={`h${i}`} x1="18" y1={28+i*34.5} x2="618" y2={28+i*34.5} stroke="#343a38" strokeWidth="1" opacity=".6"/>)}
      <path d={path} fill="none" stroke={color} strokeWidth="2.3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {selected && <><line x1={x(selected.elapsed_s)} y1="14" x2={x(selected.elapsed_s)} y2="170" stroke="#cfbba3" strokeDasharray="4 4" opacity=".8"/>
        <circle cx={x(selected.elapsed_s)} cy={y(selected[field])} r="4.5" fill={color} stroke="#111" strokeWidth="2" /></>}
      <text x="18" y="199" className="scope-label">{startT.toFixed(1)}s</text>
      <text x="618" y="199" className="scope-label" textAnchor="end">{endT.toFixed(1)}s</text>
      <rect x="18" y="12" width="600" height="160" fill="transparent" onMouseMove={event => {
        if (!recent.length) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const time = startT + clamp((event.clientX-bounds.left)/bounds.width, 0, 1)*span;
        let nearest = 0;
        for (let i=1;i<recent.length;i++) if (Math.abs(recent[i].elapsed_s-time) < Math.abs(recent[nearest].elapsed_s-time)) nearest=i;
        setHover(nearest);
      }}/>
    </svg>
  </div>;
}

export function RevLights({ rpm }: {rpm:number}) {
  // 10 LED segments intentionally use a demo-only 2k..6.8k reference range.
  const on = clamp(Math.floor((rpm - 1800) / 500), 0, 10);
  return <div className="revlight-rail" role="img" aria-label={`${on} of 10 demonstration shift lights active`}>
    {Array.from({length: 10}, (_, i) => <span key={i} className={`rev-led ${i<on?'rev-led--lit':''} ${i>=7?'rev-led--red':''}`}/>)}
  </div>;
}

export function ThrottleStack({ value }: {value:number}) {
  const lit = Math.round(clamp(value / 100, 0, 1) * 12);
  return <div className="throttle-unit"><div className="throttle-name">THROTTLE <span>INPUT</span></div><div className="throttle-stack">
    {Array.from({length: 12},(_,i) => <span key={i} className={i < lit ? 'lit':''}/>)}
  </div><div className="throttle-readout">{value.toFixed(0)}<small>%</small></div></div>;
}
