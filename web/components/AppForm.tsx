"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, useApi } from "@/lib/api";

export type App = {
  id: string; name: string; description: string | null; url: string; kind: string; environment: string; status: string;
  lastLatencyMs: number | null; lastCheckedAt: string | null; uptime24h: number | null; enabled: boolean;
  server: { id: string; name: string } | null;
};
type ServerLite = { id: string; name: string };
type Ping = { ok: boolean; statusCode: number | null; latencyMs: number | null; error: string | null; url: string };

export function AppForm({ initial, cancelHref }: { initial?: Partial<App> & { expectedStatus?: number; method?: string; timeoutMs?: number; insecureTls?: boolean; healthUrl?: string | null }; cancelHref: string }) {
  const router = useRouter();
  const { data: servers } = useApi<ServerLite[]>("/servers", 0);
  const [f, setF] = useState({
    name: initial?.name ?? "", url: initial?.url ?? "https://", healthUrl: initial?.healthUrl ?? "", description: initial?.description ?? "",
    kind: initial?.kind ?? "web", environment: initial?.environment ?? "production",
    method: initial?.method ?? "GET", expectedStatus: initial?.expectedStatus ?? 200, timeoutMs: initial?.timeoutMs ?? 10000,
    serverId: initial?.server?.id ?? "",
    insecureTls: initial?.insecureTls ?? false,
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ping, setPing] = useState<Ping | "loading" | null>(null);
  const set = (k: string, v: unknown) => {
    setF((p) => ({ ...p, [k]: v }));
    if (["url", "healthUrl", "method", "expectedStatus", "timeoutMs", "insecureTls"].includes(k)) setPing(null);
  };

  async function runPing() {
    setPing("loading");
    try {
      setPing(await api<Ping>("/apps/test", { method: "POST", json: f }));
    } catch (e) {
      setPing({ ok: false, statusCode: null, latencyMs: null, error: (e as Error).message, url: "" });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const saved = initial?.id
        ? await api<{ id: string }>(`/apps/${initial.id}`, { method: "PATCH", json: f })
        : await api<{ id: string }>("/apps", { method: "POST", json: f });
      router.push(`/apps/${saved.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card form-card form-grid reveal" style={{ "--i": 1 } as React.CSSProperties}>
        <label className="field">Name<input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Client Portal" required autoFocus /></label>
        <label className="field">Environment
          <select className="input" value={f.environment} onChange={(e) => set("environment", e.target.value)}><option value="production">Production</option><option value="staging">Staging</option><option value="dev">Development</option></select>
        </label>
        <label className="field full">App URL<input className="input" type="url" value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://chado.vegax.ai" required />
          <span className="hint">The address people open. Shown on the dashboard.</span>
        </label>
        <div className="field full">
          <label htmlFor="healthUrl">Health-check endpoint <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <div className="row" style={{ gap: 8 }}>
            <input id="healthUrl" className="input" value={f.healthUrl} onChange={(e) => set("healthUrl", e.target.value)} placeholder="/health   or   https://api.chado.vegax.ai/health" />
            <button type="button" className="btn" onClick={runPing} disabled={ping === "loading" || !f.url}>{ping === "loading" ? "Pinging…" : "Ping"}</button>
          </div>
          <span className="hint">The URL DevMonitor probes. A path like <code>/health</code> is added to the App URL. Leave empty to check the App URL itself.</span>
          {ping && ping !== "loading" && (
            <div className={`ping-result ${ping.ok ? "ok" : "bad"}`} role="status">
              <b>{ping.ok ? "Healthy" : "Unhealthy"}</b>
              {ping.statusCode != null && <span>HTTP {ping.statusCode}</span>}
              {ping.latencyMs != null && <span>{ping.latencyMs} ms</span>}
              {ping.error && <span>{ping.error}</span>}
              {ping.url && <span className="mono truncate">{ping.url}</span>}
            </div>
          )}
        </div>
        <label className="field">Type
          <select className="input" value={f.kind} onChange={(e) => set("kind", e.target.value)}><option value="web">Web app</option><option value="api">API</option><option value="service">Service</option></select>
        </label>
        <label className="field">Hosted on
          <select className="input" value={f.serverId} onChange={(e) => set("serverId", e.target.value)}><option value="">— none —</option>{servers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <label className="field">Expected status<input className="input" type="number" value={f.expectedStatus} onChange={(e) => set("expectedStatus", Number(e.target.value))} /></label>
        <label className="field">Timeout (ms)<input className="input" type="number" step={1000} value={f.timeoutMs} onChange={(e) => set("timeoutMs", Number(e.target.value))} /></label>
        <label className="full row" style={{ gap: 10, fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={f.insecureTls} onChange={(e) => set("insecureTls", e.target.checked)} style={{ width: 17, height: 17, accentColor: "var(--brand-600)" }} />
          <span>Allow self-signed certificate <span className="muted">— for dev/staging hosts served on a raw IP</span></span>
        </label>
        <label className="field full">Description<input className="input" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional" /></label>
        {err && <div className="alert full">{err}</div>}
        <div className="row full" style={{ justifyContent: "flex-end" }}>
          <Link href={cancelHref} className="btn ghost">Cancel</Link>
          <button className="btn primary" disabled={busy}>{busy ? "Saving…" : initial?.id ? "Save changes" : "Add application"}</button>
        </div>
    </form>
  );
}

