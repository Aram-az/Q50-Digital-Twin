import { useId, useState } from 'react';
import type { TelemetrySample } from '../lib/types';

type Field = 'engine_rpm' | 'vehicle_speed_kph' | 'coolant_temp_c' | 'intake_temp_c' | 'throttle_pct';

export function MiniGauge({ value, maximum, color, unit }: { value: number; maximum: number; color: string; unit: string }) {
  const fraction = Math.max(0, Math.min(1, value / maximum));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return <svg className="mini-gauge" viewBox="0 0 120 120" role="img" aria-label={`${value.toFixed(0)} ${unit}`}>
    <circle cx="60" cy="60" r={radius} fill="none" stroke="#26323f" strokeWidth="8" strokeDasharray={`${circumference * .72} ${circumference}`} transform="rotate(140 60 60)" strokeLinecap="round" />
    <circle cx="60" cy="60" r={radius} fill="none" stroke={color} strokeWidth="8" strokeDasharray={`${circumference * .72 * fraction} ${circumference}`} transform="rotate(140 60 60)" strokeLinecap="round" className="gauge-progress" />
    <text x="60" y="59" textAnchor="middle" className="gauge-value">{value.toFixed(0)}</text>
    <text x="60" y="76" textAnchor="middle" className="gauge-unit">{unit}</text>
  </svg>;
}

export function TelemetryChart({ samples, field, color, secondaryField, secondaryColor }: {
  samples: TelemetrySample[]; field: Field; color: string;
  secondaryField?: Field; secondaryColor?: string;
}) {
  const gradientId = useId().replace(/:/g, '');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const recent = samples.slice(-140);
  const width = 680;
  const height = 208;
  const marginX = 8;
  const chartH = 170;
  const minT = recent[0]?.elapsed_s ?? 0;
  const maxT = recent.at(-1)?.elapsed_s ?? 1;
  const timeSpan = Math.max(0.1, maxT - minT);
  const x = (time: number) => marginX + (time - minT) / timeSpan * (width - 2 * marginX);
  const pointsFor = (f: Field) => {
    const vals = recent.map(s => s[f]);
    const min = Math.min(...vals, 0);
    const max = Math.max(...vals, 1);
    const extent = max - min || 1;
    const y = (v: number) => 13 + (1 - (v - min) / extent) * (chartH - 24);
    const line = recent.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.elapsed_s).toFixed(2)},${y(s[f]).toFixed(2)}`).join(' ');
    return { line, area: `${line} L${x(maxT)},${chartH} L${x(minT)},${chartH} Z`, y };
  };
  const main = recent.length ? pointsFor(field) : null;
  const secondary = secondaryField && recent.length ? pointsFor(secondaryField) : null;
  const hovered = hoverIndex !== null ? recent[hoverIndex] : null;

  return <div className="chart-shell">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Graph of ${field.replaceAll('_', ' ')} across session time`} onMouseLeave={() => setHoverIndex(null)}>
      <defs>
        <linearGradient id={`fill-${gradientId}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".23" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[.15,.37,.59,.81].map(p => <line key={p} x1="0" x2={width} y1={p * chartH} y2={p * chartH} stroke="#344051" strokeWidth="1" strokeDasharray="3 7" opacity=".65" />)}
      {main && <>
        <path d={main.area} fill={`url(#fill-${gradientId})`} />
        <path d={main.line} fill="none" stroke={color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      </>}
      {secondary && <path d={secondary.line} fill="none" stroke={secondaryColor || '#f4b962'} strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />}
      {hovered && <>
        <line x1={x(hovered.elapsed_s)} y1="7" x2={x(hovered.elapsed_s)} y2={chartH} stroke="#b8c5d3" strokeOpacity=".65" strokeDasharray="4 4" />
        <circle cx={x(hovered.elapsed_s)} cy={main?.y(hovered[field])} r="4" stroke="#070d14" strokeWidth="2" fill={color} />
      </>}
      <rect x="0" y="0" width={width} height={chartH} fill="transparent" onMouseMove={event => {
        if (!recent.length) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const proportion = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        setHoverIndex(Math.round(proportion * (recent.length - 1)));
      }} />
      <text x="8" y="198" fill="#8292a4" fontSize="12">{minT.toFixed(1)} s</text>
      <text x={width - 8} y="198" textAnchor="end" fill="#8292a4" fontSize="12">{maxT.toFixed(1)} s</text>
    </svg>
    {hovered && <div className="chart-tooltip">t={hovered.elapsed_s.toFixed(1)}s · {hovered[field].toFixed(1)} {secondaryField && `· ${hovered[secondaryField].toFixed(1)}`}</div>}
  </div>;
}

/** Original generic sedan drawing, not a manufacturer CAD model. */
export function VehicleGraphic({ hot }: { hot: boolean }) {
  return <svg viewBox="0 0 610 230" className="vehicle-svg" role="img" aria-label="Stylized synthetic vehicle visualization">
    <defs>
      <linearGradient id="body" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#dce5ed" /><stop offset=".48" stopColor="#8093a8" /><stop offset="1" stopColor="#334454" /></linearGradient>
      <linearGradient id="glass" x1="0" x2="1"><stop stopColor="#1b3342" /><stop offset="1" stopColor="#445e6a" /></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="8" /></filter>
    </defs>
    <ellipse cx="307" cy="189" rx="255" ry="17" fill="#0e1b25" filter="url(#glow)" opacity=".8" />
    <path d="M56 149 L74 129 L150 121 L213 68 Q232 52 264 52 L388 52 Q415 53 435 73 L490 122 L539 133 Q554 139 559 155 L559 174 L47 174 L49 158 Z" fill="url(#body)" stroke="#d7e4ed" strokeWidth="1.4" />
    <path d="M165 120 L220 76 Q234 66 264 66 L300 66 L299 120 Z" fill="url(#glass)" stroke="#a9bfcc" strokeWidth="1.4" />
    <path d="M315 66 L387 66 Q405 68 423 86 L455 120 L315 120 Z" fill="url(#glass)" stroke="#a9bfcc" strokeWidth="1.4" />
    <path d="M302 66 L302 120 M464 123 L493 131" stroke="#c5d5df" strokeWidth="3" />
    <path d="M65 143 H544" stroke="#ebf3f7" strokeWidth="2" opacity=".56" />
    <path d="M197 141 H268 M341 141 H409" stroke="#101d2b" strokeWidth="4" strokeLinecap="round" />
    <path d="M65 140 L108 140 L105 148 L59 151 Z" fill="#cfd6eb" />
    <path d="M527 136 L555 145 L554 153 L515 148 Z" fill="#e0545b" />
    <path d="M52 157 L72 157 M521 161 L550 161" stroke="#0c1723" strokeWidth="5" />
    {[158,453].map(cx => <g key={cx}>
      <circle cx={cx} cy="171" r="40" fill="#0a121b" stroke="#131d28" strokeWidth="3" />
      <circle cx={cx} cy="171" r="26" fill="#aebcc6" />
      <circle cx={cx} cy="171" r="20" fill="#334453" />
      {[0,60,120,180,240,300].map(a => <line key={a} x1={cx} y1="152" x2={cx} y2="166" stroke="#dae4ec" strokeWidth="3" transform={`rotate(${a} ${cx} 171)`} />)}
      <circle cx={cx} cy="171" r="7" fill="#9babb9" />
    </g>)}
    {hot && <circle cx="308" cy="92" r="53" fill="#ec6d45" fillOpacity=".16" stroke="#ef855a" strokeDasharray="4 5" />}
    <text x="305" y="224" textAnchor="middle" fontSize="11" fill="#718398" letterSpacing="3">CONCEPT VISUALIZATION · NOT VEHICLE CAD</text>
  </svg>;
}
