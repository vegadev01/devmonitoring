"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useApi } from "@/lib/api";
import { ago, ms } from "@/lib/format";
import {
  ENV_KEY, HISTORY_KEY, METHODS, blankReq, buildWire, envMap, fromSaved, load, store, toCurl, toSavedPayload, unresolved,
  type Auth, type BodyType, type HistoryItem, type KV, type Req, type Resp, type Saved,
} from "@/lib/studio";
import { KvEditor } from "@/components/KvEditor";
import { JsonView } from "@/components/JsonView";
import { ConfirmButton, Empty } from "@/components/ui";
import { IconBolt, IconClock, IconPlus, IconSearch, IconTrash } from "@/components/Icons";

type Tab = "params" | "headers" | "auth" | "body" | "settings";
type Side = "saved" | "history" | "env";

const rate = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(2)} MB`);
const statusTone = (s: number) => (s < 300 ? "ok" : s < 400 ? "info" : s < 500 ? "warn" : "bad");
const count = (rows: KV[]) => rows.filter((r) => r.enabled && r.key.trim()).length;

export default function StudioPage() {
  const [req, setReq] = useState<Req>(blankReq);
  const [tab, setTab] = useState<Tab>("params");
  const [side, setSide] = useState<Side>("saved");
  const [resp, setResp] = useState<Resp | null>(null);
  const [sending, setSending] = useState(false);
  const [respTab, setRespTab] = useState<"body" | "headers">("body");
  const [pretty, setPretty] = useState(true);
  const [env, setEnv] = useState<KV[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loaded, setLoaded] = useState<Saved | null>(null);
  const [saveForm, setSaveForm] = useState<{ name: string; collection: string } | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState("");
  const [prefillName, setPrefillName] = useState("");
  const { data: saved, reload } = useApi<Saved[]>("/studio/requests", 0);

  const patch = useCallback((p: Partial<Req>) => setReq((r) => ({ ...r, ...p })), []);

  // Restore per-browser env + history, and prefill from ?url= (e.g. "API Studio" button on an app).
  useEffect(() => {
    setEnv(load<KV[]>(ENV_KEY, []));
    setHistory(load<HistoryItem[]>(HISTORY_KEY, []));
    const q = new URLSearchParams(window.location.search);
    const url = q.get("url");
    if (url) {
      setReq({ ...blankReq(), url, insecureTls: q.get("insecure") === "1" });
      setPrefillName(q.get("name") ?? "");
    }
  }, []);

  const updateEnv = (rows: KV[]) => {
    setEnv(rows);
    store(ENV_KEY, rows);
  };

  const vars = useMemo(() => envMap(env), [env]);
  const missing = useMemo(() => unresolved(req, vars), [req, vars]);
  const wire = useMemo(() => buildWire(req, env), [req, env]);

  const sendNow = useCallback(async () => {
    if (!req.url.trim() || sending) return;
    setSending(true);
    setResp(null);
    try {
      const r = await api<Resp>("/studio/send", { method: "POST", json: wire });
      setResp(r);
      setRespTab("body");
      const item: HistoryItem = { at: Date.now(), req, status: r.ok ? r.status : null, timeMs: r.ok ? r.timeMs : null };
      setHistory((h) => {
        const next = [item, ...h].slice(0, 40);
        store(HISTORY_KEY, next);
        return next;
      });
    } catch (e) {
      setResp({ ok: false, error: (e as Error).message });
    } finally {
      setSending(false);
    }
  }, [req, wire, sending]);

  // Ctrl/Cmd + Enter sends from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        sendNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sendNow]);

  async function save(asNew: boolean) {
    setSaveMsg("");
    try {
      if (loaded && !asNew) {
        const s = await api<Saved>(`/studio/requests/${loaded.id}`, { method: "PATCH", json: toSavedPayload(req) });
        setLoaded(s);
        setSaveMsg("Saved");
      } else {
        if (!saveForm?.name.trim()) return;
        const s = await api<Saved>("/studio/requests", { method: "POST", json: { ...toSavedPayload(req), name: saveForm.name, collection: saveForm.collection } });
        setLoaded(s);
        setSaveForm(null);
        setSaveMsg("Saved");
      }
      reload();
      setTimeout(() => setSaveMsg(""), 1800);
    } catch (e) {
      setSaveMsg((e as Error).message);
    }
  }

  function open(s: Saved) {
    setReq(fromSaved(s));
    setLoaded(s);
    setSaveForm(null);
    setResp(null);
  }

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(""), 1500);
  }

  const groups = useMemo(() => {
    const m = new Map<string, Saved[]>();
    for (const s of saved ?? []) {
      if (filter && !`${s.name} ${s.url} ${s.method}`.toLowerCase().includes(filter.toLowerCase())) continue;
      m.set(s.collection, [...(m.get(s.collection) ?? []), s]);
    }
    return [...m.entries()];
  }, [saved, filter]);

  const dirty = loaded ? JSON.stringify(toSavedPayload(req)) !== JSON.stringify(toSavedPayload(fromSaved(loaded))) : false;
  const bodyAllowed = !["GET", "HEAD"].includes(req.method);

  return (
    <div className="studio">
      {/* ---------- Sidebar ---------- */}
      <aside className="card studio-side reveal">
        <div className="seg studio-seg">
          <button className={side === "saved" ? "on" : ""} onClick={() => setSide("saved")}>Saved</button>
          <button className={side === "history" ? "on" : ""} onClick={() => setSide("history")}>History</button>
          <button className={side === "env" ? "on" : ""} onClick={() => setSide("env")}>Variables</button>
        </div>

        {side === "saved" && (
          <>
            <div className="row" style={{ gap: 8 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <IconSearch style={{ position: "absolute", left: 10, top: 10, width: 15, color: "var(--muted)" }} />
                <input className="input" style={{ paddingLeft: 32, fontSize: 13.5 }} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <button className="btn icon-btn" title="New request" aria-label="New request" onClick={() => { setReq(blankReq()); setLoaded(null); setResp(null); }}><IconPlus /></button>
            </div>
            <Link href="/studio/import" className="btn" style={{ fontSize: 13.5 }}>Import OpenAPI / Swagger</Link>
            <div className="studio-list">
              {!groups.length ? (
                <Empty icon={<IconBolt />} title={saved?.length ? "No matches" : "Nothing saved yet"}>{saved?.length ? "Try another filter." : "Send a request, then Save it — or import an OpenAPI spec."}</Empty>
              ) : groups.map(([name, items]) => (
                <details key={name} open>
                  <summary><span className="truncate">{name}</span><span className="muted small">{items.length}</span></summary>
                  {items.map((s) => (
                    <button key={s.id} className={`studio-item ${loaded?.id === s.id ? "active" : ""}`} onClick={() => open(s)} title={s.url}>
                      <span className={`m m-${s.method}`}>{s.method}</span>
                      <span className="truncate">{s.name}</span>
                    </button>
                  ))}
                  <div className="studio-coll-actions">
                    <ConfirmButton className="btn ghost small-btn" confirmLabel={`Delete all ${items.length}?`} onConfirm={async () => { await api(`/studio/collections/${encodeURIComponent(name)}`, { method: "DELETE" }); if (loaded?.collection === name) setLoaded(null); reload(); }}>Delete collection</ConfirmButton>
                  </div>
                </details>
              ))}
            </div>
          </>
        )}

        {side === "history" && (
          <div className="studio-list">
            {!history.length ? <Empty icon={<IconClock />} title="No history yet">Requests you send appear here (stored in this browser).</Empty> : (
              <>
                {history.map((h, i) => (
                  <button key={h.at + "-" + i} className="studio-item" onClick={() => { setReq(h.req); setLoaded(null); setResp(null); }} title={h.req.url}>
                    <span className={`m m-${h.req.method}`}>{h.req.method}</span>
                    <span className="truncate" style={{ flex: 1 }}>{h.req.url.replace(/^https?:\/\//, "")}</span>
                    <span className={`code-chip ${h.status == null ? "bad" : statusTone(h.status)}`}>{h.status ?? "ERR"}</span>
                  </button>
                ))}
                <button className="btn ghost small-btn" onClick={() => { setHistory([]); store(HISTORY_KEY, []); }}>Clear history</button>
              </>
            )}
          </div>
        )}

        {side === "env" && (
          <div className="stack" style={{ gap: 10 }}>
            <p className="muted small">Use <code className="inline-code">{"{{name}}"}</code> in the URL, params, headers, auth or body. Stored in this browser.</p>
            <KvEditor rows={env} onChange={updateEnv} keyPlaceholder="baseUrl" valuePlaceholder="https://api.example.com" />
          </div>
        )}
      </aside>

      {/* ---------- Request + response ---------- */}
      <section className="studio-main">
        <div className="card reveal" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="row between wrap" style={{ marginBottom: 12, gap: 8 }}>
            <div className="truncate">
              <b>{loaded ? loaded.name : "Untitled request"}</b>
              {loaded && <span className="muted small"> · {loaded.collection}{dirty ? " · unsaved changes" : ""}</span>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {saveMsg && <span className="small" style={{ color: saveMsg === "Saved" ? "var(--ok)" : "var(--bad)" }}>{saveMsg}</span>}
              <button className="btn small-btn" onClick={() => copy(toCurl(wire), "curl")} disabled={!req.url}>{copied === "curl" ? "Copied" : "Copy as cURL"}</button>
              {loaded && <button className="btn small-btn" disabled={!dirty} onClick={() => save(false)}>Save</button>}
              <button className="btn small-btn" onClick={() => setSaveForm(saveForm ? null : { name: loaded ? `${loaded.name} (copy)` : prefillName, collection: loaded?.collection ?? "General" })}>{loaded ? "Save as…" : "Save…"}</button>
            </div>
          </div>

          {saveForm && (
            <form className="save-row" onSubmit={(e) => { e.preventDefault(); save(true); }}>
              <input className="input" autoFocus placeholder="Request name" value={saveForm.name} onChange={(e) => setSaveForm({ ...saveForm, name: e.target.value })} required />
              <input className="input" placeholder="Collection" list="collections" value={saveForm.collection} onChange={(e) => setSaveForm({ ...saveForm, collection: e.target.value })} />
              <datalist id="collections">{[...new Set((saved ?? []).map((s) => s.collection))].map((c) => <option key={c} value={c} />)}</datalist>
              <button className="btn primary small-btn">Save</button>
              <button type="button" className="btn ghost small-btn" onClick={() => setSaveForm(null)}>Cancel</button>
            </form>
          )}

          <form className="req-bar" onSubmit={(e) => { e.preventDefault(); sendNow(); }}>
            <select className={`input method-select m-${req.method}`} value={req.method} onChange={(e) => patch({ method: e.target.value })} aria-label="Method">
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
            <input className="input mono url-input" placeholder="https://api.example.com/v1/health   or   {{baseUrl}}/users" value={req.url} onChange={(e) => patch({ url: e.target.value })} aria-label="URL" />
            <button className="btn primary send-btn" disabled={sending || !req.url.trim()}>{sending ? "Sending…" : "Send"}</button>
          </form>
          {missing.length > 0 && <div className="alert warn small" style={{ marginTop: 10 }}>Undefined variable{missing.length > 1 ? "s" : ""}: {missing.map((m) => <code key={m} className="inline-code">{m}</code>)} — add {missing.length > 1 ? "them" : "it"} under Variables.</div>}
          {req.url && <div className="muted small mono truncate" style={{ marginTop: 8 }} title={wire.url}>→ {wire.url}</div>}

          <div className="tabs" role="tablist">
            {([
              ["params", `Params${count(req.params) ? ` (${count(req.params)})` : ""}`],
              ["headers", `Headers${count(req.headers) ? ` (${count(req.headers)})` : ""}`],
              ["auth", `Auth${req.auth.type !== "none" ? " •" : ""}`],
              ["body", `Body${req.bodyType !== "none" ? " •" : ""}`],
              ["settings", "Settings"],
            ] as [Tab, string][]).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{label}</button>
            ))}
          </div>

          <div className="tab-panel">
            {tab === "params" && <KvEditor rows={req.params} onChange={(params) => patch({ params })} keyPlaceholder="query param" />}
            {tab === "headers" && <KvEditor rows={req.headers} onChange={(headers) => patch({ headers })} keyPlaceholder="Header-Name" />}
            {tab === "auth" && <AuthEditor auth={req.auth} onChange={(auth) => patch({ auth })} />}
            {tab === "body" && (
              <div className="stack" style={{ gap: 10 }}>
                <div className="seg">
                  {(["none", "json", "text", "form"] as BodyType[]).map((b) => (
                    <button key={b} className={req.bodyType === b ? "on" : ""} onClick={() => patch({ bodyType: b })}>{b === "form" ? "Form (urlencoded)" : b === "json" ? "JSON" : b[0].toUpperCase() + b.slice(1)}</button>
                  ))}
                </div>
                {!bodyAllowed && req.bodyType !== "none" && <div className="alert warn small">{req.method} requests don't send a body — switch the method to POST, PUT or PATCH.</div>}
                {(req.bodyType === "json" || req.bodyType === "text") && (
                  <>
                    <textarea className="input mono body-input" spellCheck={false} value={req.body} onChange={(e) => patch({ body: e.target.value })} placeholder={req.bodyType === "json" ? '{\n  "key": "value"\n}' : "Raw text body"} />
                    {req.bodyType === "json" && req.body.trim() && (
                      <div className="row between small">
                        <JsonStatus text={req.body} />
                        <button className="btn ghost small-btn" onClick={() => { try { patch({ body: JSON.stringify(JSON.parse(req.body), null, 2) }); } catch { /* invalid JSON: leave as is */ } }}>Format</button>
                      </div>
                    )}
                  </>
                )}
                {req.bodyType === "form" && <KvEditor rows={req.form} onChange={(form) => patch({ form })} keyPlaceholder="field" />}
              </div>
            )}
            {tab === "settings" && (
              <div className="stack" style={{ gap: 12 }}>
                <label className="check-row"><input type="checkbox" checked={req.insecureTls} onChange={(e) => patch({ insecureTls: e.target.checked })} />Allow self-signed / invalid TLS certificates</label>
                <label className="check-row"><input type="checkbox" checked={req.followRedirects} onChange={(e) => patch({ followRedirects: e.target.checked })} />Follow redirects (up to 5)</label>
                <label className="field" style={{ maxWidth: 220 }}>Timeout (ms)<input className="input" type="number" min={1000} max={120000} step={1000} value={req.timeoutMs} onChange={(e) => patch({ timeoutMs: Number(e.target.value) || 30000 })} /></label>
              </div>
            )}
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>Tip: <kbd>Ctrl</kbd> + <kbd>Enter</kbd> sends. Requests run from the DevMonitor server, so internal hosts and APIs without CORS work.</p>
        </div>

        <div className="card reveal resp-card" style={{ "--i": 2 } as React.CSSProperties}>
          {sending ? (
            <div className="resp-empty"><div className="spinner" />Waiting for response…</div>
          ) : !resp ? (
            <div className="resp-empty"><IconBolt />Send a request to see the response here.</div>
          ) : !resp.ok ? (
            <div className="stack">
              <div className="row"><span className="code-chip bad big">Error</span></div>
              <div className="alert">{resp.error}</div>
            </div>
          ) : (
            <>
              <div className="row wrap between" style={{ gap: 10 }}>
                <div className="row wrap" style={{ gap: 10 }}>
                  <span className={`code-chip big ${statusTone(resp.status)}`}>{resp.status} {resp.statusText}</span>
                  <span className="muted small">{ms(resp.timeMs)}</span>
                  <span className="muted small">{rate(resp.size)}</span>
                  {resp.redirects > 0 && <span className="muted small truncate" title={resp.finalUrl}>{resp.redirects} redirect{resp.redirects > 1 ? "s" : ""} → {resp.finalUrl}</span>}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="seg">
                    <button className={respTab === "body" ? "on" : ""} onClick={() => setRespTab("body")}>Body</button>
                    <button className={respTab === "headers" ? "on" : ""} onClick={() => setRespTab("headers")}>Headers ({Object.keys(resp.headers).length})</button>
                  </div>
                  {respTab === "body" && resp.body != null && (
                    <>
                      <button className="btn small-btn" onClick={() => setPretty(!pretty)}>{pretty ? "Raw" : "Pretty"}</button>
                      <button className="btn small-btn" onClick={() => copy(resp.body!, "body")}>{copied === "body" ? "Copied" : "Copy"}</button>
                    </>
                  )}
                </div>
              </div>
              {resp.truncated && <div className="alert warn small" style={{ marginTop: 10 }}>Response is larger than 2 MB — showing the first 2 MB.</div>}
              <div className="resp-body">
                {respTab === "headers" ? (
                  <table className="hdr-table">
                    <tbody>
                      {Object.entries(resp.headers).map(([k, v]) => (
                        <tr key={k}><th>{k}</th><td className="mono">{Array.isArray(v) ? v.join(", ") : v}</td></tr>
                      ))}
                    </tbody>
                  </table>
                ) : resp.binary ? (
                  <div className="resp-empty">Binary response ({resp.contentType || "unknown type"}, {rate(resp.size)}) — not displayed.</div>
                ) : !resp.body ? (
                  <div className="resp-empty">Empty body</div>
                ) : (
                  <JsonView text={resp.body} pretty={pretty} />
                )}
              </div>
            </>
          )}
        </div>
        {loaded && (
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <span className="muted small" style={{ marginRight: "auto" }}>Last saved {ago(loaded.updatedAt)}</span>
            <ConfirmButton className="btn danger small-btn" confirmLabel="Delete this saved request?" onConfirm={async () => { await api(`/studio/requests/${loaded.id}`, { method: "DELETE" }); setLoaded(null); reload(); }}><IconTrash /> Delete saved request</ConfirmButton>
          </div>
        )}
      </section>
    </div>
  );
}

function JsonStatus({ text }: { text: string }) {
  try {
    JSON.parse(text);
    return <span style={{ color: "var(--ok)" }}>Valid JSON</span>;
  } catch (e) {
    return <span style={{ color: "var(--bad)" }} className="truncate">Invalid JSON: {(e as Error).message}</span>;
  }
}

function AuthEditor({ auth, onChange }: { auth: Auth; onChange: (a: Auth) => void }) {
  const pick = (type: Auth["type"]) =>
    onChange(
      type === "bearer" ? { type, token: "" } : type === "basic" ? { type, username: "", password: "" } : type === "apikey" ? { type, name: "X-API-Key", value: "", in: "header" } : { type: "none" }
    );
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="seg">
        {(["none", "bearer", "basic", "apikey"] as Auth["type"][]).map((t) => (
          <button key={t} className={auth.type === t ? "on" : ""} onClick={() => pick(t)}>{{ none: "None", bearer: "Bearer token", basic: "Basic auth", apikey: "API key" }[t]}</button>
        ))}
      </div>
      {auth.type === "bearer" && <label className="field">Token<input className="input mono" value={auth.token} onChange={(e) => onChange({ ...auth, token: e.target.value })} placeholder="eyJhbGciOi…   or   {{token}}" /></label>}
      {auth.type === "basic" && (
        <div className="form-grid">
          <label className="field">Username<input className="input" value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} /></label>
          <label className="field">Password<input className="input" type="password" value={auth.password} onChange={(e) => onChange({ ...auth, password: e.target.value })} /></label>
        </div>
      )}
      {auth.type === "apikey" && (
        <div className="form-grid">
          <label className="field">Name<input className="input mono" value={auth.name} onChange={(e) => onChange({ ...auth, name: e.target.value })} /></label>
          <label className="field">Value<input className="input mono" value={auth.value} onChange={(e) => onChange({ ...auth, value: e.target.value })} /></label>
          <label className="field">Send in
            <select className="input" value={auth.in} onChange={(e) => onChange({ ...auth, in: e.target.value as "header" | "query" })}><option value="header">Header</option><option value="query">Query string</option></select>
          </label>
        </div>
      )}
      {auth.type !== "none" && <p className="muted small">Saved with the request in DevMonitor's database — prefer a <code className="inline-code">{"{{variable}}"}</code> for real secrets.</p>}
    </div>
  );
}
