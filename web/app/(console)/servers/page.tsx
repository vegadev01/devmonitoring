"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api";
import { ago, rate } from "@/lib/format";
import { Empty, Gauge, Skeleton, StatusPill } from "@/components/ui";
import { IconPlus, IconSearch, IconServer } from "@/components/Icons";

export type Metric = { cpuPct: number | null; ramPct: number | null; gpuPct: number | null; diskPct: number | null; netRxBytes: number | null; netTxBytes: number | null; createdAt: string };
type Server = { id: string; name: string; hostname: string | null; status: string; lastSeenAt: string | null; latest: Metric | null; _count: { apps: number } };

type SortKey = "name" | "cpuPct" | "ramPct" | "diskPct" | "lastSeen";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "cpuPct", label: "CPU usage" },
  { key: "ramPct", label: "RAM usage" },
  { key: "diskPct", label: "Disk usage" },
  { key: "lastSeen", label: "Last seen" },
];
const STATUSES = [["all", "All"], ["online", "Online"], ["offline", "Offline"], ["pending", "Waiting"]] as const;
const PREFS_KEY = "dm.servers.view";

export default function ServersPage() {
  const { data, loading } = useApi<Server[]>("/servers", 15_000);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number][0]>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [desc, setDesc] = useState(true); // metrics: highest first by default

  // Remember the chosen sort per browser.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
      if (SORTS.some((x) => x.key === p.sort)) setSort(p.sort);
      if (typeof p.desc === "boolean") setDesc(p.desc);
    } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ sort, desc })); } catch { /* storage unavailable */ }
  }, [sort, desc]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (data ?? []).filter(
      (s) => (status === "all" || s.status === status) && (!needle || `${s.name} ${s.hostname ?? ""}`.toLowerCase().includes(needle))
    );
    const value = (s: Server): number | null =>
      sort === "lastSeen" ? (s.lastSeenAt ? new Date(s.lastSeenAt).getTime() : null) : sort === "name" ? null : s.latest?.[sort] ?? null;
    return rows.sort((a, b) => {
      if (sort === "name") return (desc ? -1 : 1) * -a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      const va = value(a), vb = value(b);
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1; // servers without data always go last
      if (vb == null) return -1;
      return desc ? vb - va : va - vb;
    });
  }, [data, q, status, sort, desc]);

  const online = data?.filter((s) => s.status === "online").length ?? 0;
  const counts = (k: string) => (k === "all" ? data?.length ?? 0 : data?.filter((s) => s.status === k).length ?? 0);
  const dirLabel = sort === "name" ? (desc ? "A → Z" : "Z → A") : sort === "lastSeen" ? (desc ? "Most recent" : "Oldest") : desc ? "Highest first" : "Lowest first";

  return (
    <div className="stack">
      <div className="row between wrap" style={{ gap: 12 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <div style={{ position: "relative" }}>
            <IconSearch style={{ position: "absolute", left: 12, top: 11, width: 17, color: "var(--muted)" }} />
            <input className="input" style={{ paddingLeft: 38, width: 230 }} placeholder="Search servers…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search servers" />
          </div>
          <div className="seg" role="tablist" aria-label="Filter by status">
            {STATUSES.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={status === k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>
                {label}<span className="seg-count">{counts(k)}</span>
              </button>
            ))}
          </div>
          <div className="sort-ctl">
            <label htmlFor="server-sort" className="muted small">Sort by</label>
            <select id="server-sort" className="input" value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setDesc(true); }}>
              {SORTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <button className="btn dir-btn" onClick={() => setDesc(!desc)} title="Reverse order" aria-label={`Order: ${dirLabel}. Click to reverse`}>
              <span aria-hidden style={{ display: "inline-block", transform: desc ? "none" : "rotate(180deg)", transition: "transform .3s var(--ease)" }}>↓</span>{dirLabel}
            </button>
          </div>
        </div>
        <Link href="/servers/new" className="btn primary"><IconPlus />Add server</Link>
      </div>
      {data && <span className="muted small">{list.length === data.length ? `${online} of ${data.length} online` : `Showing ${list.length} of ${data.length} · ${online} online`}</span>}
      {loading && !data ? <div className="grid cards">{[0, 1].map((i) => <div className="card" key={i}><Skeleton h={150} /></div>)}</div>
        : !data?.length ? <div className="card"><Empty icon={<IconServer />} title="No servers yet">Add a server and install the agent to see CPU, memory, GPU, disk and network.</Empty></div>
        : !list.length ? <div className="card"><Empty icon={<IconSearch />} title="No matching servers">Try another search or status filter.</Empty></div>
        : (
          <div className="grid cards">
            {list.map((s, i) => (
              <Link href={`/servers/${s.id}`} key={s.id} className="card app-card reveal" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                <div className="top">
                  <div className="row" style={{ gap: 12, minWidth: 0, alignItems: "flex-start" }}>
                    <div className="icon-chip"><IconServer /></div>
                    <div className="app-id"><h3 title={s.name}>{s.name}</h3><div className="muted small">{s._count.apps} app{s._count.apps === 1 ? "" : "s"} · seen {ago(s.lastSeenAt)}</div></div>
                  </div>
                  <StatusPill status={s.status} />
                </div>
                <div className="gauges">
                  <div className={sort === "cpuPct" ? "gauge-focus" : ""}><Gauge label="CPU" value={s.latest?.cpuPct ?? null} /></div>
                  <div className={sort === "ramPct" ? "gauge-focus" : ""}><Gauge label="RAM" value={s.latest?.ramPct ?? null} /></div>
                  <Gauge label="GPU" value={s.latest?.gpuPct ?? null} color="var(--slate-500)" />
                  <div className={sort === "diskPct" ? "gauge-focus" : ""}><Gauge label="Disk" value={s.latest?.diskPct ?? null} color="var(--brand-300)" /></div>
                </div>
                <div className="meta"><span>↓ <b>{rate(s.latest?.netRxBytes)}</b></span><span>↑ <b>{rate(s.latest?.netTxBytes)}</b></span></div>
              </Link>
            ))}
          </div>
        )}
    </div>
  );
}
