"use client";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { ago, ms, pct, duration } from "@/lib/format";
import { Stat, Skeleton, Empty, StatusPill } from "@/components/ui";
import { Chart, Legend } from "@/components/Chart";
import { IconAlert, IconApps, IconBolt, IconCheck, IconPulse, IconServer } from "@/components/Icons";

type Overview = {
  apps: { total: number; up: number; down: number; unknown: number };
  servers: { total: number; online: number };
  openIncidents: number;
  uptime24h: number | null;
  avgLatency24h: number | null;
  series: { t: number; uptime: number; latencyMs: number | null }[];
  recentIncidents: { id: string; kind: string; reason: string; startedAt: string; resolvedAt: string | null; app: { id: string; name: string } | null; server: { id: string; name: string } | null }[];
};
type App = { id: string; name: string; status: string; url: string; environment: string; lastLatencyMs: number | null; uptime24h: number | null };

export default function OverviewPage() {
  const { data: ov, loading } = useApi<Overview>("/overview", 20_000);
  const { data: apps } = useApi<App[]>("/apps", 20_000);

  if (loading && !ov) return <div className="grid stats">{[0, 1, 2, 3].map((i) => <div key={i} className="card"><Skeleton h={90} /></div>)}</div>;
  if (!ov) return <div className="alert">Could not load overview.</div>;

  const allUp = ov.apps.total > 0 && ov.apps.down === 0;
  const lat = [{ key: "latencyMs", label: "Avg latency", color: "var(--brand-500)" }];
  const up = [{ key: "uptime", label: "Uptime", color: "var(--ok)" }];

  return (
    <div className="stack">
      <section className="card reveal" style={{ background: "linear-gradient(135deg, var(--brand-800), var(--brand-600) 60%, var(--brand-500))", color: "#fff", border: 0, padding: "28px clamp(20px,3vw,34px)", position: "relative", overflow: "hidden" }}>
        <img src="/logo.svg" alt="" aria-hidden style={{ position: "absolute", right: -30, top: -30, width: 240, opacity: 0.12, filter: "brightness(5)" }} />
        <div className="row" style={{ gap: 18, position: "relative" }}>
          <div className="icon-chip" style={{ width: 54, height: 54, background: "rgba(255,255,255,.16)", color: "#fff", borderRadius: 16 }}>{allUp ? <IconCheck style={{ width: 28, height: 28 }} /> : <IconAlert style={{ width: 28, height: 28 }} />}</div>
          <div>
            <div style={{ fontSize: "clamp(20px,3vw,28px)", fontWeight: 700, letterSpacing: "-0.02em" }}>
              {ov.apps.total === 0 ? "Welcome to DevMonitor" : allUp ? "All Veganext applications are operational" : `${ov.apps.down} application${ov.apps.down > 1 ? "s need" : " needs"} attention`}
            </div>
            <div style={{ opacity: 0.8, marginTop: 2 }}>
              {ov.apps.total === 0 ? "Add your first application to start monitoring." : `${ov.apps.up} of ${ov.apps.total} apps up · ${ov.servers.online} of ${ov.servers.total} servers online`}
            </div>
          </div>
        </div>
      </section>

      <div className="grid stats">
        <Stat i={1} label="Apps up" icon={<IconApps />} value={ov.apps.up} sub={`${ov.apps.total} monitored`} />
        <Stat i={2} label="Servers online" icon={<IconServer />} value={ov.servers.online} sub={`${ov.servers.total} registered`} />
        <Stat i={3} label="Uptime · 24h" icon={<IconPulse />} value={ov.uptime24h} unit="%" decimals={2} sub="across all checks" />
        <Stat i={4} label="Avg latency" icon={<IconBolt />} value={ov.avgLatency24h} unit="ms" sub="successful checks, 24h" />
      </div>

      <div className="grid two">
        <div className="stack">
          <div className="card reveal" style={{ "--i": 5 } as React.CSSProperties}>
            <h2>Response time · last 24h</h2>
            <Chart data={ov.series as never} series={lat} format={(v) => ms(v)} />
          </div>
          <div className="card reveal" style={{ "--i": 6 } as React.CSSProperties}>
            <div className="row between"><h2>Fleet uptime · last 24h</h2><Legend series={up} /></div>
            <Chart data={ov.series as never} series={up} height={170} domain={[0, 100]} format={(v) => `${Math.round(v)}%`} />
          </div>
        </div>

        <div className="stack">
          <div className="card reveal" style={{ "--i": 5 } as React.CSSProperties}>
            <div className="row between"><h2>Applications</h2><Link href="/apps" className="small" style={{ color: "var(--accent)", fontWeight: 600 }}>View all →</Link></div>
            {!apps?.length ? <Empty icon={<IconApps />} title="No applications yet"><Link href="/apps" style={{ color: "var(--accent)" }}>Add one</Link></Empty> : (
              <div className="list">
                {apps.slice(0, 7).map((a) => (
                  <Link href={`/apps/${a.id}`} key={a.id} className="list-item">
                    <span className={`dot ${a.status === "down" ? "bad" : a.status === "up" ? "" : "idle"}`} />
                    <div className="truncate" style={{ flex: 1 }}><b>{a.name}</b><div className="muted small truncate">{a.url.replace(/^https?:\/\//, "")}</div></div>
                    <span className="muted small">{ms(a.lastLatencyMs)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="card reveal" style={{ "--i": 6 } as React.CSSProperties}>
            <div className="row between"><h2>Recent incidents</h2><Link href="/incidents" className="small" style={{ color: "var(--accent)", fontWeight: 600 }}>History →</Link></div>
            {!ov.recentIncidents.length ? <Empty icon={<IconCheck />} title="Nothing to report">No incidents recorded.</Empty> : (
              <div className="list">
                {ov.recentIncidents.map((i) => (
                  <div className="list-item" key={i.id}>
                    <div className={`icon-chip ${i.resolvedAt ? "ok" : "bad"}`}>{i.resolvedAt ? <IconCheck /> : <IconAlert />}</div>
                    <div className="truncate" style={{ flex: 1 }}>
                      <b>{i.app?.name ?? i.server?.name}</b>
                      <div className="muted small truncate">{i.reason}</div>
                    </div>
                    <div className="small muted" style={{ textAlign: "right" }}>{ago(i.startedAt)}<br />{i.resolvedAt ? duration(i.startedAt, i.resolvedAt) : <StatusPill status="down" />}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
