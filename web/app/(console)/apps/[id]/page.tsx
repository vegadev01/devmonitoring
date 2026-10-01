"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { ago, duration, ms, pct, when } from "@/lib/format";
import { ConfirmButton, RangeTabs, Skeleton, Stat, StatusPill, UptimeBar, Empty } from "@/components/ui";
import { Chart } from "@/components/Chart";
import { IconBolt, IconCheck, IconClock, IconExternal, IconPulse, IconRefresh, IconShield, IconTrash } from "@/components/Icons";
import type { App } from "@/components/AppForm";

type Detail = {
  app: App & { method: string; expectedStatus: number; timeoutMs: number; insecureTls: boolean };
  summary: { uptime: number | null; checks: number; avgLatency: number | null; p95Latency: number | null };
  series: { t: number; latencyMs: number | null; up: number | null }[];
  recent: { id: string; ok: boolean; statusCode: number | null; latencyMs: number | null; error: string | null; createdAt: string }[];
  incidents: { id: string; reason: string; startedAt: string; resolvedAt: string | null }[];
};

export default function AppDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [range, setRange] = useState("24h");
  const { data, loading, reload } = useApi<Detail>(`/apps/${id}?range=${range}`, 20_000);
  const [checking, setChecking] = useState(false);

  if (loading && !data) return <div className="stack"><div className="card"><Skeleton h={80} /></div><div className="card"><Skeleton h={240} /></div></div>;
  if (!data) return <div className="card"><Empty icon={<IconShield />} title="Application not found"><Link href="/apps" style={{ color: "var(--accent)" }}>Back to applications</Link></Empty></div>;
  const { app, summary } = data;

  return (
    <div className="stack">
      <div className="card reveal">
        <div className="row between wrap">
          <div className="truncate">
            <div className="row wrap" style={{ gap: 12 }}>
              <h1 style={{ fontSize: 26, letterSpacing: "-0.02em" }}>{app.name}</h1>
              <StatusPill status={app.enabled ? app.status : "unknown"} />
            </div>
            <a href={app.url} target="_blank" rel="noreferrer" className="muted small row" style={{ gap: 6, marginTop: 4 }}>{app.url}<IconExternal style={{ width: 13 }} /></a>
            {app.description && <p className="muted small" style={{ marginTop: 6 }}>{app.description}</p>}
          </div>
          <div className="row wrap">
            <button className="btn" disabled={checking} onClick={async () => { setChecking(true); await api(`/apps/${id}/check`, { method: "POST" }).catch(() => {}); await reload(); setChecking(false); }}>
              <IconRefresh className={checking ? "spin" : ""} />Check now
            </button>
            <Link href={`/apps/${id}/edit`} className="btn">Edit</Link>
            <ConfirmButton className="btn danger" ariaLabel="Delete" confirmLabel="Delete app + history?" onConfirm={async () => { await api(`/apps/${id}`, { method: "DELETE" }); router.replace("/apps"); }}><IconTrash /></ConfirmButton>
          </div>
        </div>
        <div style={{ marginTop: 18 }}><UptimeBar checks={[...data.recent].reverse()} /></div>
        <div className="row between small muted" style={{ marginTop: 6 }}><span>Last 30 checks</span><span>Updated {ago(app.lastCheckedAt)}</span></div>
      </div>

      <div className="row between wrap"><span className="muted small">{app.method} · expects {app.expectedStatus} · timeout {app.timeoutMs / 1000}s{app.insecureTls && " · self-signed TLS allowed"}{app.server && <> · hosted on <Link href={`/servers/${app.server.id}`} style={{ color: "var(--accent)" }}>{app.server.name}</Link></>}</span><RangeTabs value={range} onChange={setRange} /></div>

      <div className="grid stats">
        <Stat i={1} label="Uptime" icon={<IconPulse />} value={summary.uptime} unit="%" decimals={2} sub={`${summary.checks} checks`} />
        <Stat i={2} label="Avg latency" icon={<IconBolt />} value={summary.avgLatency} unit="ms" sub="successful checks" />
        <Stat i={3} label="p95 latency" icon={<IconClock />} value={summary.p95Latency} unit="ms" sub="slowest 5% threshold" />
        <Stat i={4} label="Incidents" icon={<IconShield />} value={data.incidents.length} sub={data.incidents.some((i) => !i.resolvedAt) ? "one is ongoing" : "all resolved"} />
      </div>

      <div className="grid even">
        <div className="card reveal"><h2>Response time</h2><Chart data={data.series as never} series={[{ key: "latencyMs", label: "Latency", color: "var(--brand-500)" }]} format={ms} /></div>
        <div className="card reveal"><h2>Availability</h2><Chart data={data.series as never} series={[{ key: "up", label: "Availability", color: "var(--ok)" }]} domain={[0, 100]} format={(v) => pct(v, 0)} /></div>
      </div>

      <div className="grid even">
        <div className="card reveal">
          <h2>Recent checks</h2>
          <div className="list">
            {data.recent.slice(0, 12).map((c) => (
              <div className="list-item" key={c.id}>
                <span className={`dot ${c.ok ? "" : "bad"}`} style={{ animation: "none" }} />
                <div className="truncate" style={{ flex: 1 }}><b>{c.ok ? `HTTP ${c.statusCode}` : c.error ?? "Check failed"}</b><div className="muted small">{when(c.createdAt)}</div></div>
                <span className="muted small">{ms(c.latencyMs)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card reveal">
          <h2>Incident history</h2>
          {!data.incidents.length ? <Empty icon={<IconCheck />} title="No incidents">This application has been healthy.</Empty> : (
            <div className="list">
              {data.incidents.map((i) => (
                <div className="list-item" key={i.id}>
                  <div className={`icon-chip ${i.resolvedAt ? "ok" : "bad"}`}>{i.resolvedAt ? <IconCheck /> : <IconShield />}</div>
                  <div style={{ flex: 1 }}><b>{i.reason}</b><div className="muted small">{when(i.startedAt)} · {i.resolvedAt ? `lasted ${duration(i.startedAt, i.resolvedAt)}` : "ongoing"}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
