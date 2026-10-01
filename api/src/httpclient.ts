import http from "node:http";
import https from "node:https";

export type SendOptions = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  insecureTls?: boolean;
  timeoutMs?: number;
  followRedirects?: boolean;
  /** Bytes of response body to keep; the rest is drained and dropped. */
  maxBody?: number;
};

export type SendResult = {
  status: number;
  statusText: string;
  headers: Record<string, string | string[]>;
  body: Buffer;
  truncated: boolean;
  size: number;
  timeMs: number;
  finalUrl: string;
  redirects: number;
};

const UA = "VeganextDevMonitor/1.0";

/** One HTTP(S) request with per-request TLS verification, timeout and manual redirect handling. */
export function send(opts: SendOptions, hops = 0, started = Date.now()): Promise<SendResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBody = opts.maxBody ?? 0;
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(opts.url);
    } catch {
      return reject(new Error("Invalid URL"));
    }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error("Only http and https URLs are supported"));

    const headers: Record<string, string> = { "User-Agent": UA, Accept: "*/*", ...opts.headers };
    const payload = opts.body != null && opts.body !== "" && !["GET", "HEAD"].includes(opts.method) ? Buffer.from(opts.body) : null;
    if (payload) headers["Content-Length"] = String(payload.length);

    const req = (u.protocol === "https:" ? https : http).request(
      u,
      { method: opts.method, headers, rejectUnauthorized: !opts.insecureTls },
      (res) => {
        const status = res.statusCode ?? 0;
        const loc = res.headers.location;
        if (opts.followRedirects !== false && status >= 300 && status < 400 && loc && hops < 5) {
          res.resume();
          // 303 (and 301/302 for non-GET, as browsers do) switch to GET without a body.
          const toGet = status === 303 || ((status === 301 || status === 302) && opts.method !== "HEAD");
          const next = { ...opts, url: new URL(loc, u).toString(), ...(toGet ? { method: "GET", body: null } : {}) };
          return resolve(send(next, hops + 1, started));
        }
        const chunks: Buffer[] = [];
        let kept = 0;
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (kept < maxBody) {
            const slice = c.subarray(0, maxBody - kept);
            chunks.push(slice);
            kept += slice.length;
          }
        });
        res.on("end", () =>
          resolve({
            status,
            statusText: res.statusMessage ?? "",
            headers: res.headers as Record<string, string | string[]>,
            body: Buffer.concat(chunks),
            truncated: size > kept,
            size,
            timeMs: Date.now() - started,
            finalUrl: u.toString(),
            redirects: hops,
          })
        );
        res.on("error", reject);
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error(`Timed out after ${timeoutMs}ms`), { name: "TimeoutError" })));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Human-readable reason for a network-level failure. */
export function describeError(e: unknown): string {
  const err = e as Error & { code?: string };
  if (err.name === "TimeoutError") return err.message;
  const byCode: Record<string, string> = {
    ENOTFOUND: "DNS lookup failed — host not found",
    ECONNREFUSED: "Connection refused",
    ECONNRESET: "Connection reset by the server",
    EHOSTUNREACH: "Host unreachable",
    DEPTH_ZERO_SELF_SIGNED_CERT: "Self-signed certificate (enable \"Allow self-signed certificate\")",
    SELF_SIGNED_CERT_IN_CHAIN: "Self-signed certificate in chain (enable \"Allow self-signed certificate\")",
    CERT_HAS_EXPIRED: "TLS certificate has expired",
    ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate does not match the hostname",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "Unable to verify TLS certificate",
  };
  return (err.code && byCode[err.code]) || err.message || "Request failed";
}
