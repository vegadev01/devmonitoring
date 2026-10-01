// API Studio request model + helpers (variables, auth, history). Pure functions, no React.
export type KV = { key: string; value: string; enabled: boolean };
export type Auth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apikey"; name: string; value: string; in: "header" | "query" };
export type BodyType = "none" | "json" | "text" | "form";

export type Req = {
  method: string;
  url: string;
  params: KV[];
  headers: KV[];
  bodyType: BodyType;
  body: string;
  form: KV[];
  auth: Auth;
  insecureTls: boolean;
  followRedirects: boolean;
  timeoutMs: number;
};

export type Saved = {
  id: string; name: string; collection: string; method: string; url: string; params: KV[]; headers: KV[];
  bodyType: BodyType; body: string | null; auth: Auth; insecureTls: boolean; updatedAt: string;
};

export type Resp =
  | { ok: false; error: string }
  | {
      ok: true; status: number; statusText: string; headers: Record<string, string | string[]>; timeMs: number; size: number;
      truncated: boolean; finalUrl: string; redirects: number; contentType: string; body: string | null; binary: boolean;
    };

export type HistoryItem = { at: number; req: Req; status: number | null; timeMs: number | null };

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export const blankReq = (): Req => ({
  method: "GET", url: "", params: [], headers: [], bodyType: "none", body: "", form: [],
  auth: { type: "none" }, insecureTls: false, followRedirects: true, timeoutMs: 30000,
});

export function fromSaved(s: Saved): Req {
  const base = blankReq();
  const isForm = s.bodyType === "form";
  let form: KV[] = [];
  if (isForm && s.body) try { form = JSON.parse(s.body); } catch { form = []; }
  return {
    ...base, method: s.method, url: s.url, params: s.params ?? [], headers: s.headers ?? [], bodyType: s.bodyType ?? "none",
    body: isForm ? "" : s.body ?? "", form, auth: s.auth?.type ? s.auth : { type: "none" }, insecureTls: s.insecureTls,
  };
}

export function toSavedPayload(r: Req) {
  return {
    method: r.method, url: r.url, params: clean(r.params), headers: clean(r.headers), bodyType: r.bodyType,
    body: r.bodyType === "form" ? JSON.stringify(clean(r.form)) : r.bodyType === "none" ? null : r.body,
    auth: r.auth, insecureTls: r.insecureTls,
  };
}

const clean = (rows: KV[]) => rows.filter((r) => r.key.trim() || r.value.trim());

// ---- variables: {{name}} --------------------------------------------------
const VAR = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function envMap(env: KV[]) {
  const m = new Map<string, string>();
  for (const e of env) if (e.enabled && e.key.trim()) m.set(e.key.trim(), e.value);
  return m;
}

export const subst = (s: string, vars: Map<string, string>) => s.replace(VAR, (all, k) => (vars.has(k) ? vars.get(k)! : all));

export function unresolved(r: Req, vars: Map<string, string>) {
  const texts = [r.url, r.body, ...[...r.params, ...r.headers, ...r.form].filter((x) => x.enabled).flatMap((x) => [x.key, x.value]), JSON.stringify(r.auth)];
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(VAR)) if (!vars.has(m[1])) out.add(m[1]);
  return [...out];
}

function b64(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/** Resolves variables, params, auth and body into the wire request sent to /studio/send. */
export function buildWire(r: Req, env: KV[]) {
  const vars = envMap(env);
  const v = (s: string) => subst(s, vars);
  let url = v(r.url.trim());
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;

  const query = r.params.filter((p) => p.enabled && p.key.trim()).map((p) => [v(p.key), v(p.value)]);
  const headers = r.headers.filter((h) => h.enabled && h.key.trim()).map((h) => ({ key: v(h.key), value: v(h.value), enabled: true }));
  const has = (name: string) => headers.some((h) => h.key.toLowerCase() === name.toLowerCase());

  const a = r.auth;
  if (a.type === "bearer" && a.token) headers.push({ key: "Authorization", value: `Bearer ${v(a.token)}`, enabled: true });
  if (a.type === "basic" && (a.username || a.password)) headers.push({ key: "Authorization", value: `Basic ${b64(`${v(a.username)}:${v(a.password)}`)}`, enabled: true });
  if (a.type === "apikey" && a.name) {
    if (a.in === "query") query.push([v(a.name), v(a.value)]);
    else headers.push({ key: v(a.name), value: v(a.value), enabled: true });
  }

  if (query.length) {
    const qs = new URLSearchParams(query).toString();
    url += (url.includes("?") ? (url.endsWith("?") || url.endsWith("&") ? "" : "&") : "?") + qs;
  }

  let body: string | null = null;
  if (r.bodyType === "json" || r.bodyType === "text") {
    body = v(r.body);
    if (!has("content-type")) headers.push({ key: "Content-Type", value: r.bodyType === "json" ? "application/json" : "text/plain", enabled: true });
  } else if (r.bodyType === "form") {
    body = new URLSearchParams(r.form.filter((f) => f.enabled && f.key.trim()).map((f) => [v(f.key), v(f.value)])).toString();
    if (!has("content-type")) headers.push({ key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true });
  }
  return { method: r.method, url, headers, body, insecureTls: r.insecureTls, followRedirects: r.followRedirects, timeoutMs: r.timeoutMs };
}

/** "curl ..." for the resolved request, for sharing or terminal use. */
export function toCurl(w: ReturnType<typeof buildWire>) {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const parts = ["curl", w.insecureTls ? "-k" : "", w.followRedirects ? "-L" : "", "-X", w.method, q(w.url)];
  for (const h of w.headers) parts.push("-H", q(`${h.key}: ${h.value}`));
  if (w.body) parts.push("--data-raw", q(w.body));
  return parts.filter(Boolean).join(" ");
}

// ---- local persistence (per browser) ----------------------------------------
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — features degrade to in-memory */
  }
}
export const ENV_KEY = "dm.studio.env";
export const HISTORY_KEY = "dm.studio.history";
