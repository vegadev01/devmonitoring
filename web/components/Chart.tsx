"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type Series = { key: string; label: string; color: string };
type Point = { t: number } & Record<string, number | null>;

/** Dependency-free responsive area/line chart with hover tooltip. */
export function Chart({ data, series, height = 220, format, domain, stacked = false }: {
  data: Point[]; series: Series[]; height?: number; format: (v: number) => string; domain?: [number, number]; stacked?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 44, r: 10, t: 10, b: 24 };
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const { x, y, yMax, yMin } = useMemo(() => {
    const vals = data.flatMap((d) => series.map((s) => d[s.key]).filter((v): v is number => v != null));
    const lo = domain ? domain[0] : 0;
    let hi = domain ? domain[1] : Math.max(1, ...vals) * 1.15;
    if (!domain && hi === 0) hi = 1;
    const t0 = data[0]?.t ?? 0;
    const t1 = data[data.length - 1]?.t ?? 1;
    return {
      yMin: lo, yMax: hi,
      x: (t: number) => pad.l + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw),
      y: (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih,
    };
  }, [data, series, domain, iw, ih]);

  if (data.length < 2) {
    return <div className="muted small" style={{ height, display: "grid", placeItems: "center" }}>Not enough data yet — check back in a few minutes.</div>;
  }

  const paths = series.map((s) => {
    const segs: string[] = [];
    let open = false;
    for (const d of data) {
      const v = d[s.key];
      if (v == null) { open = false; continue; }
      segs.push(`${open ? "L" : "M"}${x(d.t).toFixed(1)} ${y(v).toFixed(1)}`);
      open = true;
    }
    const line = segs.join(" ");
    const pts = data.filter((d) => d[s.key] != null);
    const area = pts.length > 1 ? `${line} L${x(pts[pts.length - 1].t).toFixed(1)} ${y(yMin)} L${x(pts[0].t).toFixed(1)} ${y(yMin)} Z` : "";
    return { s, line, area, len: Math.ceil(iw * 2.5) };
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => yMin + (yMax - yMin) * k);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((k) => data[0].t + (data[data.length - 1].t - data[0].t) * k);
  const span = data[data.length - 1].t - data[0].t;
  const fmtT = (t: number) => new Date(t).toLocaleString(undefined, span > 36e5 * 30 ? { month: "short", day: "numeric" } : span > 36e5 * 26 ? { weekday: "short", hour: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

  const onMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0, bd = Infinity;
    data.forEach((d, i) => { const dd = Math.abs(x(d.t) - px); if (dd < bd) { bd = dd; best = i; } });
    setHover(best);
  };
  const hd = hover != null ? data[hover] : null;

  return (
    <div className="chart" ref={wrap} style={{ height }}>
      <svg width={w} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: "pan-y" }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity="0.32" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((v, i) => (
          <g key={i}>
            <line className="grid-line" x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end">{format(v)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={height - 6} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>{fmtT(t)}</text>
        ))}
        {paths.map(({ s, line, area, len }) => (
          <g key={s.key}>
            {!stacked && area && <path className="area" d={area} fill={`url(#g-${s.key})`} />}
            <path className="line" d={line} stroke={s.color} style={{ ["--len" as string]: len }} />
          </g>
        ))}
        {hd && (
          <g>
            <line x1={x(hd.t)} x2={x(hd.t)} y1={pad.t} y2={pad.t + ih} stroke="var(--brand-400)" strokeOpacity=".5" />
            {series.map((s) => hd[s.key] != null && <circle key={s.key} cx={x(hd.t)} cy={y(hd[s.key] as number)} r="4.5" fill="var(--surface)" stroke={s.color} strokeWidth="2.2" />)}
          </g>
        )}
      </svg>
      {hd && (
        <div className="tooltip" style={{ left: Math.min(w - 90, Math.max(90, x(hd.t))), top: pad.t + 20 }}>
          <div className="t">{new Date(hd.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          {series.map((s) => (
            <div className="l" key={s.key}><span><i className="sw" style={{ background: s.color }} />{s.label}</span><b>{hd[s.key] == null ? "—" : format(hd[s.key] as number)}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return <div className="legend">{series.map((s) => <span key={s.key} style={{ ["--c" as string]: s.color }}>{s.label}</span>)}</div>;
}
