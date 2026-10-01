"use client";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { ago, rate } from "@/lib/format";
import { Empty, Gauge, Skeleton, StatusPill } from "@/components/ui";
import { IconPlus, IconServer } from "@/components/Icons";

export type Metric = { cpuPct: number | null; ramPct: number | null; gpuPct: number | null; diskPct: number | null; netRxBytes: number | null; netTxBytes: number | null; createdAt: string };
type Server = { id: string; name: string; hostname: string | null; status: string; lastSeenAt: string | null; latest: Metric | null; _count: { apps: number } };

export default function ServersPage() {
  const { data, loading } = useApi<Server[]>("/servers", 15_000);

  return (
    <div className="stack">
      <div className="row between"><span className="muted">{data ? `${data.filter((s) => s.status === "online").length} of ${data.length} online` : ""}</span><Link href="/servers/new" className="btn primary"><IconPlus />Add server</Link></div>
      {loading && !data ? <div className="grid cards">{[0, 1].map((i) => <div className="card" key={i}><Skeleton h={150} /></div>)}</div>
        : !data?.length ? <div className="card"><Empty icon={<IconServer />} title="No servers yet">Add a server and install the agent to see CPU, memory, GPU, disk and network.</Empty></div>
        : (
          <div className="grid cards">
            {data.map((s, i) => (
              <Link href={`/servers/${s.id}`} key={s.id} className="card app-card reveal" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                <div className="top">
                  <div className="row" style={{ gap: 12, minWidth: 0 }}>
                    <div className="icon-chip"><IconServer /></div>
                    <div className="truncate"><h3 className="truncate">{s.name}</h3><div className="muted small">{s._count.apps} app{s._count.apps === 1 ? "" : "s"} · seen {ago(s.lastSeenAt)}</div></div>
                  </div>
                  <StatusPill status={s.status} />
                </div>
                <div className="gauges">
                  <Gauge label="CPU" value={s.latest?.cpuPct ?? null} />
                  <Gauge label="RAM" value={s.latest?.ramPct ?? null} />
                  <Gauge label="GPU" value={s.latest?.gpuPct ?? null} color="var(--slate-500)" />
                  <Gauge label="Disk" value={s.latest?.diskPct ?? null} color="var(--brand-300)" />
                </div>
                <div className="meta"><span>↓ <b>{rate(s.latest?.netRxBytes)}</b></span><span>↑ <b>{rate(s.latest?.netTxBytes)}</b></span></div>
              </Link>
            ))}
          </div>
        )}
    </div>
  );
}
