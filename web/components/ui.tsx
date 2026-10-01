"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { IconArrowLeft, IconCheck } from "./Icons";
import type { Status } from "@/lib/format";

export function StatusPill({ status }: { status: Status | string }) {
  const label: Record<string, string> = { up: "Operational", down: "Down", unknown: "Pending", online: "Online", offline: "Offline", pending: "Waiting for agent" };
  return (
    <span className={`pill ${status}`}>
      <span className="dot idle" style={status === "up" || status === "online" ? { background: "var(--ok)" } : undefined} />
      {label[status] ?? status}
    </span>
  );
}

/** Smoothly counts toward `value` — numbers feel alive when data refreshes. */
export function CountUp({ value, decimals = 0 }: { value: number | null; decimals?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (value == null) return;
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 800);
      const eased = 1 - Math.pow(1 - k, 4);
      setShown(start + (value - start) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{value == null ? "—" : shown.toFixed(decimals)}</>;
}

export function Stat({ label, icon, value, unit, decimals = 0, sub, i = 0 }: {
  label: string; icon: ReactNode; value: number | null; unit?: string; decimals?: number; sub?: ReactNode; i?: number;
}) {
  return (
    <div className="card stat reveal" style={{ "--i": i } as React.CSSProperties}>
      <div className="label">{icon}{label}</div>
      <div className="value"><CountUp value={value} decimals={decimals} />{value != null && unit && <small>{unit}</small>}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

/** Back link + page title used by the dedicated form pages. */
export function PageHeader({ back, backLabel, title, subtitle }: { back: string; backLabel: string; title: string; subtitle?: string }) {
  return (
    <div className="page-head reveal">
      <Link href={back} className="back-link"><IconArrowLeft />{backLabel}</Link>
      <h1>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
    </div>
  );
}

/** Two-step inline confirmation instead of a browser confirm() pop-up. */
export function ConfirmButton({ onConfirm, children, confirmLabel = "Click again to confirm", className = "btn", ariaLabel }: {
  onConfirm: () => Promise<unknown> | void; children: ReactNode; confirmLabel?: string; className?: string; ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`${className} ${armed ? "armed" : ""}`}
      aria-label={armed ? confirmLabel : ariaLabel}
      disabled={busy}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setBusy(true);
        try { await onConfirm(); } finally { setBusy(false); setArmed(false); }
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function CopyBox({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="codebox">
      {text}
      <button
        className="btn"
        style={{ padding: "5px 10px", fontSize: 12 }}
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }}
      >
        {done ? <><IconCheck /> Copied</> : "Copy"}
      </button>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <b style={{ color: "var(--text)" }}>{title}</b>
      <div className="small">{children}</div>
    </div>
  );
}

export function Skeleton({ h = 20, w = "100%" }: { h?: number; w?: string | number }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}

export function RangeTabs({ value, onChange, options = ["1h", "6h", "24h", "7d", "30d"] }: { value: string; onChange: (v: string) => void; options?: string[] }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o} className={o === value ? "on" : ""} onClick={() => onChange(o)} role="tab" aria-selected={o === value}>{o}</button>
      ))}
    </div>
  );
}

export function Gauge({ label, value, color = "var(--brand-500)" }: { label: string; value: number | null; color?: string }) {
  const r = 26, c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.min(100, Math.max(0, value));
  const tone = v > 90 ? "var(--bad)" : v > 75 ? "var(--warn)" : color;
  return (
    <div className="gauge">
      <div className="ring">
        <svg viewBox="0 0 64 64">
          <circle className="track" cx="32" cy="32" r={r} />
          <circle className="bar" cx="32" cy="32" r={r} stroke={value == null ? "transparent" : tone} strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
        </svg>
        <span className="num">{value == null ? "—" : Math.round(v)}</span>
      </div>
      {label}
    </div>
  );
}

/** Row of recent checks as coloured ticks (like a status page). */
export function UptimeBar({ checks }: { checks: { ok: boolean }[] }) {
  const slots = 30;
  const items = [...Array(Math.max(0, slots - checks.length)).fill(null), ...checks.slice(-slots)];
  return (
    <div className="uptime-bar" aria-label="Recent checks">
      {items.map((c, i) => <i key={i} className={c == null ? "" : c.ok ? "ok" : "bad"} />)}
    </div>
  );
}
