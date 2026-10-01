"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/api";
import { ms, pct, ago } from "@/lib/format";
import { Empty, Skeleton, StatusPill } from "@/components/ui";
import type { App } from "@/components/AppForm";
import { IconApps, IconExternal, IconPlus, IconSearch } from "@/components/Icons";

export default function AppsPage() {
  const { data, loading } = useApi<App[]>("/apps", 20_000);
  const [q, setQ] = useState("");
  const [env, setEnv] = useState("all");

  const list = useMemo(
    () => (data ?? []).filter((a) => (env === "all" || a.environment === env) && `${a.name} ${a.url}`.toLowerCase().includes(q.toLowerCase())),
    [data, q, env]
  );

  return (
    <div className="stack">
      <div className="row wrap between">
        <div className="row wrap">
          <div style={{ position: "relative" }}>
            <IconSearch style={{ position: "absolute", left: 12, top: 11, width: 17, color: "var(--muted)" }} />
            <input className="input" style={{ paddingLeft: 38, width: 260 }} placeholder="Search applications…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="seg">
            {["all", "production", "staging", "dev"].map((e) => <button key={e} className={env === e ? "on" : ""} onClick={() => setEnv(e)}>{e === "all" ? "All" : e[0].toUpperCase() + e.slice(1)}</button>)}
          </div>
        </div>
        <Link href="/apps/new" className="btn primary"><IconPlus />Add application</Link>
      </div>

      {loading && !data ? (
        <div className="grid cards">{[0, 1, 2].map((i) => <div className="card" key={i}><Skeleton h={120} /></div>)}</div>
      ) : !list.length ? (
        <div className="card"><Empty icon={<IconApps />} title={data?.length ? "No matches" : "No applications yet"}>{data?.length ? "Try a different search or filter." : "Add your first Veganext app to start monitoring it."}</Empty></div>
      ) : (
        <div className="grid cards">
          {list.map((a, i) => (
            <Link href={`/apps/${a.id}`} key={a.id} className="card app-card reveal" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
              <div className="top">
                <div className="truncate">
                  <h3 className="truncate">{a.name}</h3>
                  <div className="muted small truncate row" style={{ gap: 5 }}>{a.url.replace(/^https?:\/\//, "")}<IconExternal style={{ width: 12, flex: "none" }} /></div>
                </div>
                <StatusPill status={a.enabled ? a.status : "unknown"} />
              </div>
              <div className="row" style={{ gap: 8 }}><span className="tag">{a.environment}</span><span className="tag">{a.kind}</span>{a.server && <span className="tag" style={{ background: "var(--slate-100)", color: "var(--muted)" }}>{a.server.name}</span>}</div>
              <div className="meta">
                <span>Uptime <b>{pct(a.uptime24h, 2)}</b></span>
                <span>Latency <b>{ms(a.lastLatencyMs)}</b></span>
                <span>Checked <b>{ago(a.lastCheckedAt)}</b></span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
