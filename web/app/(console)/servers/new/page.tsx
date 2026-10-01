"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { CopyBox, PageHeader } from "@/components/ui";

type Created = { id: string; name: string; installCommand: string };

export default function NewServerPage() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      setCreated(await api<Created>("/servers", { method: "POST", json: { name } }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  if (created) {
    return (
      <div className="stack">
        <PageHeader back="/servers" backLabel="Servers" title="Install the agent" subtitle={`${created.name} is registered. Run this on the server — the key is shown only once.`} />
        <div className="card form-card stack reveal" style={{ "--i": 1 } as React.CSSProperties}>
          <CopyBox text={created.installCommand} />
          <div className="alert warn">Requires Node.js 18+ on the target server. The server turns green as soon as its first report arrives.</div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Link href="/servers" className="btn ghost">All servers</Link>
            <Link href={`/servers/${created.id}`} className="btn primary">Open {created.name}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader back="/servers" backLabel="Servers" title="Add server" subtitle="Register a machine, then install the lightweight agent on it." />
      <form onSubmit={submit} className="card form-card stack reveal" style={{ "--i": 1 } as React.CSSProperties}>
        <label className="field">Server name<input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-web-01" required /></label>
        {err && <div className="alert">{err}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Link href="/servers" className="btn ghost">Cancel</Link>
          <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create server"}</button>
        </div>
      </form>
    </div>
  );
}
