"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/api";
import { duration, when } from "@/lib/format";
import { Empty, Skeleton, StatusPill } from "@/components/ui";
import { IconCheck } from "@/components/Icons";

type Incident = { id: string; kind: string; reason: string; startedAt: string; resolvedAt: string | null; app: { id: string; name: string } | null; server: { id: string; name: string } | null };

export default function IncidentsPage() {
  const { data, loading } = useApi<Incident[]>("/incidents", 20_000);
  const [f, setF] = useState("all");
  const list = (data ?? []).filter((i) => f === "all" || (f === "open" ? !i.resolvedAt : !!i.resolvedAt));

  return (
    <div className="stack">
      <div className="row between wrap">
        <div className="seg">{["all", "open", "resolved"].map((o) => <button key={o} className={f === o ? "on" : ""} onClick={() => setF(o)}>{o[0].toUpperCase() + o.slice(1)}</button>)}</div>
        <span className="muted small">{data?.filter((i) => !i.resolvedAt).length ?? 0} open</span>
      </div>
      {loading && !data ? <div className="card"><Skeleton h={160} /></div> : !list.length ? (
        <div className="card"><Empty icon={<IconCheck />} title="Nothing here">No incidents match this filter. Smooth sailing.</Empty></div>
      ) : (
        <div className="timeline">
          {list.map((i, n) => {
            const target = i.app ? { href: `/apps/${i.app.id}`, name: i.app.name } : i.server ? { href: `/servers/${i.server.id}`, name: i.server.name } : null;
            return (
              <div className={`item card reveal ${i.resolvedAt ? "resolved" : ""}`} style={{ "--i": Math.min(n, 10) } as React.CSSProperties} key={i.id}>
                <div className="row between wrap">
                  <div className="row" style={{ gap: 10 }}>
                    {target ? <Link href={target.href}><b style={{ fontSize: 16 }}>{target.name}</b></Link> : <b>Deleted resource</b>}
                    <span className="tag">{i.kind}</span>
                  </div>
                  <StatusPill status={i.resolvedAt ? "up" : "down"} />
                </div>
                <p style={{ margin: "6px 0 8px" }}>{i.reason}</p>
                <div className="muted small">Started {when(i.startedAt)} · {i.resolvedAt ? `resolved after ${duration(i.startedAt, i.resolvedAt)}` : `ongoing for ${duration(i.startedAt)}`}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
