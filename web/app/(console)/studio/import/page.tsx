"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ENV_KEY, load, store, type KV } from "@/lib/studio";
import { PageHeader } from "@/components/ui";

type Result = { collection: string; baseUrl: string; imported: number };

export default function ImportSpecPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("");
  const [spec, setSpec] = useState("");
  const [collection, setCollection] = useState("");
  const [insecureTls, setInsecure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api<Result>("/studio/import", { method: "POST", json: mode === "url" ? { url, collection, insecureTls } : { spec, collection, insecureTls } });
      // Imported URLs use {{baseUrl}}; define it unless the user already has one.
      const env = load<KV[]>(ENV_KEY, []);
      if (!env.some((v) => v.key === "baseUrl")) store(ENV_KEY, [...env, { key: "baseUrl", value: r.baseUrl, enabled: true }]);
      setDone(r);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="stack">
      <PageHeader back="/studio" backLabel="API Studio" title="Import OpenAPI / Swagger" subtitle="Every endpoint in the spec becomes a saved request you can send from API Studio." />
      {done ? (
        <div className="card form-card stack reveal" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="ping-result ok"><b>Imported {done.imported} endpoint{done.imported === 1 ? "" : "s"}</b><span>into “{done.collection}”</span></div>
          <p className="muted small">Requests use <code className="inline-code">{"{{baseUrl}}"}</code>, currently set to <code className="inline-code">{done.baseUrl}</code>. Change it under API Studio → Variables. Path parameters like <code className="inline-code">{"{{id}}"}</code> are variables too.</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => { setDone(null); setUrl(""); setSpec(""); }}>Import another</button>
            <button className="btn primary" onClick={() => router.push("/studio")}>Open API Studio</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="card form-card stack reveal" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="seg" style={{ width: "fit-content" }}>
            <button type="button" className={mode === "url" ? "on" : ""} onClick={() => setMode("url")}>From URL</button>
            <button type="button" className={mode === "paste" ? "on" : ""} onClick={() => setMode("paste")}>Paste JSON</button>
          </div>
          {mode === "url" ? (
            <label className="field">Spec URL<input className="input mono" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/openapi.json" />
              <span className="hint">Common locations: <code>/openapi.json</code>, <code>/swagger.json</code>, <code>/v3/api-docs</code>, <code>/api-docs-json</code>. JSON only.</span>
            </label>
          ) : (
            <label className="field">Spec JSON<textarea className="input mono body-input" required value={spec} onChange={(e) => setSpec(e.target.value)} placeholder='{ "openapi": "3.0.0", "paths": { … } }' spellCheck={false} /></label>
          )}
          <label className="field">Collection name <span className="hint">Defaults to the API title from the spec.</span><input className="input" value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="Vega 360 API" /></label>
          <label className="check-row"><input type="checkbox" checked={insecureTls} onChange={(e) => setInsecure(e.target.checked)} />Allow self-signed certificate (for fetching the spec and for the imported requests)</label>
          {err && <div className="alert">{err}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Link href="/studio" className="btn ghost">Cancel</Link>
            <button className="btn primary" disabled={busy}>{busy ? "Importing…" : "Import endpoints"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
