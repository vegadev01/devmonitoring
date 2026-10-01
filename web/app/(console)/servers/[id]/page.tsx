"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { ago, duration, pct, rate, when } from "@/lib/format";
import { ConfirmButton, Empty, Gauge, RangeTabs, Skeleton, StatusPill } from "@/components/ui";
import { Chart, Legend } from "@/components/Chart";
import { IconCheck, IconServer, IconShield, IconTrash } from "@/components/Icons";
import type { Metric } from "../page";

type Detail = {
  server: { id: string; name: string; status: string; lastSeenAt: string | null; createdAt: string; apps: { id: string; name: string; status: string; url: string }[] };
  latest: Metric | null;
  incidents: { id: string; reason: string; startedAt: string; resolvedAt: string | null }[];
  series: ({ t: number } & Record<string, number | null>)[];
};

const usage = [
  { key: "cpuPct", label: "CPU", color: "var(--brand-500)" },
  { key: "ramPct", label: "RAM", color: "var(--brand-800)" },
  { key: "gpuPct", label: "GPU", color: "#8a9096" },
  { key: "diskPct", label: "Disk", color: "var(--brand-300)" },
];
const net = [
  { key: "netRxBytes", label: "Download", color: "var(--brand-500)" },
  { key: "netTxBytes", label: "Upload", color: "#6b7076" },
];

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [range, setRange] = useState("6h");
  const { data, loading } = useApi<Detail>(`/servers/${id}?range=${range}`, 15_000);
  const [key, setKey] = useState<string | null>(null);

  if (loading && !data) return <div className="stack"><div className="card"><Skeleton h={90} /></div><div className="card"><Skeleton h={260} /></div></div>;
  if (!data) return <div className="card"><Empty icon={<IconServer />} title="Server not found"><Link href="/servers" style={{ color: "var(--accent)" }}>Back to servers</Link></Empty></div>;
  const { server, latest } = data;
  const hasGpu = data.series.some((d) => d.gpuPct != null);

  return (
    <div className="stack">
      <div className="card reveal">
        <div className="row between wrap">
          <div className="row" style={{ gap: 14 }}>
            <div className="icon-chip" style={{ width: 50, height: 50 }}><IconServer /></div>
            <div>
              <div className="row wrap" style={{ gap: 12 }}><h1 style={{ fontSize: 26, letterSpacing: "-0.02em" }}>{server.name}</h1><StatusPill status={server.status} /></div>
              <div className="muted small">Last report {ago(server.lastSeenAt)} · registered {when(server.createdAt)}</div>
            </div>
          </div>
          <div className="row wrap">
            <ConfirmButton confirmLabel="Agent will need the new key — confirm?" onConfirm={async () => { const r = await api<{ apiKey: string }>(`/servers/${id}/rotate-key`, { method: "POST" }); setKey(r.apiKey); }}>Rotate key</ConfirmButton>
            <ConfirmButton className="btn danger" ariaLabel="Delete" confirmLabel="Delete server + metrics?" onConfirm={async () => { await api(`/servers/${id}`, { method: "DELETE" }); router.replace("/servers"); }}><IconTrash /></ConfirmButton>
          </div>
        </div>
        {key && <div className="alert warn" style={{ marginTop: 14 }}>New API key (shown once): <span className="mono">{key}</span> — update <span className="mono">API_KEY</span> in /etc/systemd/system/monitoring-agent.service and restart it.</div>}
        <div className="gauges" style={{ marginTop: 22, maxWidth: 460 }}>
          <Gauge label="CPU" value={latest?.cpuPct ?? null} /><Gauge label="RAM" value={latest?.ramPct ?? null} /><Gauge label="GPU" value={latest?.gpuPct ?? null} color="var(--slate-500)" /><Gauge label="Disk" value={latest?.diskPct ?? null} color="var(--brand-300)" />
        </div>
      </div>

      <div className="row between wrap"><span className="muted small">↓ {rate(latest?.netRxBytes)} · ↑ {rate(latest?.netTxBytes)}</span><RangeTabs value={range} onChange={setRange} /></div>

      <div className="card reveal">
        <div className="row between wrap"><h2>Resource usage</h2><Legend series={hasGpu ? usage : usage.filter((u) => u.key !== "gpuPct")} /></div>
        <Chart data={data.series} series={hasGpu ? usage : usage.filter((u) => u.key !== "gpuPct")} height={260} domain={[0, 100]} format={(v) => pct(v, 0)} />
      </div>
      <div className="card reveal">
        <div className="row between wrap"><h2>Network throughput</h2><Legend series={net} /></div>
        <Chart data={data.series} series={net} format={rate} />
      </div>

      <div className="grid even">
        <div className="card reveal">
          <h2>Hosted applications</h2>
          {!server.apps.length ? <Empty icon={<IconShield />} title="Nothing linked">Assign this server when editing an application.</Empty> : (
            <div className="list">{server.apps.map((a) => (
              <Link className="list-item" href={`/apps/${a.id}`} key={a.id}><span className={`dot ${a.status === "down" ? "bad" : a.status === "up" ? "" : "idle"}`} /><div className="truncate" style={{ flex: 1 }}><b>{a.name}</b><div className="muted small truncate">{a.url}</div></div><StatusPill status={a.status} /></Link>
            ))}</div>
          )}
        </div>
        <div className="card reveal">
          <h2>Incident history</h2>
          {!data.incidents.length ? <Empty icon={<IconCheck />} title="No incidents">This server has been steady.</Empty> : (
            <div className="list">{data.incidents.map((i) => (
              <div className="list-item" key={i.id}><div className={`icon-chip ${i.resolvedAt ? "ok" : "bad"}`}>{i.resolvedAt ? <IconCheck /> : <IconShield />}</div><div><b>{i.reason}</b><div className="muted small">{when(i.startedAt)} · {i.resolvedAt ? `lasted ${duration(i.startedAt, i.resolvedAt)}` : "ongoing"}</div></div></div>
            ))}</div>
          )}
        </div>
      </div>
    </div>
  );
}
