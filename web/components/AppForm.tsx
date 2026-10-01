"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { Modal } from "@/components/ui";

export type App = {
  id: string; name: string; description: string | null; url: string; kind: string; environment: string; status: string;
  lastLatencyMs: number | null; lastCheckedAt: string | null; uptime24h: number | null; enabled: boolean;
  server: { id: string; name: string } | null;
};
type ServerLite = { id: string; name: string };

export function AppForm({ initial, onDone, onClose }: { initial?: Partial<App> & { expectedStatus?: number; method?: string; timeoutMs?: number }; onDone: () => void; onClose: () => void }) {
  const { data: servers } = useApi<ServerLite[]>("/servers", 0);
  const [f, setF] = useState({
    name: initial?.name ?? "", url: initial?.url ?? "https://", description: initial?.description ?? "",
    kind: initial?.kind ?? "web", environment: initial?.environment ?? "production",
    method: initial?.method ?? "GET", expectedStatus: initial?.expectedStatus ?? 200, timeoutMs: initial?.timeoutMs ?? 10000,
    serverId: initial?.server?.id ?? "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (initial?.id) await api(`/apps/${initial.id}`, { method: "PATCH", json: f });
      else await api("/apps", { method: "POST", json: f });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={initial?.id ? "Edit application" : "Add application"} subtitle="DevMonitor will probe this URL on every check cycle." onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <label className="field">Name<input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Client Portal" required autoFocus /></label>
        <label className="field">Environment
          <select className="input" value={f.environment} onChange={(e) => set("environment", e.target.value)}><option value="production">Production</option><option value="staging">Staging</option><option value="dev">Development</option></select>
        </label>
        <label className="field full">Health-check URL<input className="input" type="url" value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://app.veganext.com/health" required /></label>
        <label className="field">Type
          <select className="input" value={f.kind} onChange={(e) => set("kind", e.target.value)}><option value="web">Web app</option><option value="api">API</option><option value="service">Service</option></select>
        </label>
        <label className="field">Hosted on
          <select className="input" value={f.serverId} onChange={(e) => set("serverId", e.target.value)}><option value="">— none —</option>{servers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <label className="field">Expected status<input className="input" type="number" value={f.expectedStatus} onChange={(e) => set("expectedStatus", Number(e.target.value))} /></label>
        <label className="field">Timeout (ms)<input className="input" type="number" step={1000} value={f.timeoutMs} onChange={(e) => set("timeoutMs", Number(e.target.value))} /></label>
        <label className="field full">Description<input className="input" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional" /></label>
        {err && <div className="alert full">{err}</div>}
        <div className="row full" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? "Saving…" : initial?.id ? "Save changes" : "Add application"}</button>
        </div>
      </form>
    </Modal>
  );
}

