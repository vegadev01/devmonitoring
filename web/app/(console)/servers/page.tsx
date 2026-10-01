"use client";
import Link from "next/link";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { ago, rate } from "@/lib/format";
import { CopyBox, Empty, Gauge, Modal, Skeleton, StatusPill } from "@/components/ui";
import { IconPlus, IconServer } from "@/components/Icons";

export type Metric = { cpuPct: number | null; ramPct: number | null; gpuPct: number | null; diskPct: number | null; netRxBytes: number | null; netTxBytes: number | null; createdAt: string };
type Server = { id: string; name: string; hostname: string | null; status: string; lastSeenAt: string | null; latest: Metric | null; _count: { apps: number } };

function AddServer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<{ installCommand: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      setCreated(await api("/servers", { method: "POST", json: { name } }));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Modal title={created ? "Install the agent" : "Add server"} subtitle={created ? "Run this on the server as root. The key is shown only once." : "Register a machine, then install the lightweight agent on it."} onClose={onClose}>
      {created ? (
        <div className="stack">
          <CopyBox text={created.installCommand} />
          <div className="alert warn">Requires Node.js 18+ on the target server. The server turns green as soon as its first report arrives.</div>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form onSubmit={submit} className="stack">
          <label className="field">Server name<input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-web-01" required /></label>
          {err && <div className="alert">{err}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create server"}</button></div>
        </form>
      )}
    </Modal>
  );
}

export default function ServersPage() {
  const { data, loading, reload } = useApi<Server[]>("/servers", 15_000);
  const [adding, setAdding] = useState(false);

  return (
    <div className="stack">
      <div className="row between"><span className="muted">{data ? `${data.filter((s) => s.status === "online").length} of ${data.length} online` : ""}</span><button className="btn primary" onClick={() => setAdding(true)}><IconPlus />Add server</button></div>
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
      {adding && <AddServer onClose={() => setAdding(false)} onDone={reload} />}
    </div>
  );
}
