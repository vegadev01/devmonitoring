import { config } from "./config";
import windowsZones from "./windowsZones.json";

// Minimal Microsoft Graph client (client-credentials flow) for sending alert mail as a Microsoft 365
// mailbox and reading recipients' Outlook time zones. Needs an Azure app registration with the
// application permissions Mail.Send and (optional, for automatic time zones) MailboxSettings.Read.

export const graphConfigured = Boolean(config.graph.tenantId && config.graph.clientId && config.graph.clientSecret);

export class GraphError extends Error {
  constructor(message: string, public status: number, public permanent: boolean) {
    super(message);
  }
}

let token: { value: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const { tenantId, clientId, clientSecret, authorityHost } = config.graph;
  const res = await fetch(`${authorityHost}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: `${config.graph.apiHost}/.default` }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    // Wrong tenant/client id or secret: retrying won't help.
    const why = body.error_description?.split("\r\n")[0] || body.error || `HTTP ${res.status}`;
    throw new GraphError(`Azure sign-in failed: ${why}`, res.status, res.status >= 400 && res.status < 500);
  }
  token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function graph(path: string, init: RequestInit = {}) {
  const res = await fetch(`${config.graph.apiHost}/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) token = null; // force a fresh token next time
  return res;
}

async function graphError(res: Response, what: string) {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  const detail = body.error?.message || body.error?.code || res.statusText;
  const hint =
    res.status === 403 ? " — grant the app the Mail.Send application permission (with admin consent) and allow it to send as this mailbox"
    : res.status === 404 ? " — the sender mailbox was not found in this tenant"
    : "";
  // 429 and 5xx are transient; other 4xx are configuration problems.
  return new GraphError(`${what}: HTTP ${res.status} ${detail}${hint}`, res.status, res.status >= 400 && res.status < 500 && res.status !== 429);
}

/** Address part of "Name <addr@x>" or a bare address. */
export const fromAddress = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim();

export async function graphSendMail(to: string, mail: { subject: string; html: string }) {
  const sender = fromAddress(config.mailFrom);
  const res = await graph(`/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: { subject: mail.subject, body: { contentType: "HTML", content: mail.html }, toRecipients: [{ emailAddress: { address: to } }] },
      saveToSentItems: false,
    }),
  });
  if (res.status !== 202 && !res.ok) throw await graphError(res, "Microsoft Graph rejected the email");
}

/** Confirms the app can sign in to Azure (cannot prove Mail.Send without sending). */
export async function graphVerify() {
  await getToken();
}

// ---- recipients' Outlook time zones -----------------------------------------
const WIN = windowsZones as Record<string, string>;
const tzCache = new Map<string, { tz: string | null; at: number }>();
const TZ_TTL = 12 * 3600_000;
let tzPermissionMissing = false;

export const isValidTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The recipient's Outlook time zone as an IANA name, or null if unknown. Cached for 12h. */
export async function outlookTimezone(email: string): Promise<string | null> {
  if (!graphConfigured || tzPermissionMissing) return null;
  const key = email.toLowerCase();
  const hit = tzCache.get(key);
  if (hit && Date.now() - hit.at < TZ_TTL) return hit.tz;
  let tz: string | null = null;
  try {
    const res = await graph(`/users/${encodeURIComponent(email)}/mailboxSettings?$select=timeZone`);
    if (res.status === 403) tzPermissionMissing = true; // MailboxSettings.Read not granted: stop asking
    if (res.ok) {
      const raw = String(((await res.json()) as { timeZone?: string }).timeZone ?? "");
      tz = isValidTz(raw) ? raw : WIN[raw] ?? null;
    }
  } catch {
    /* network/auth issue: fall back to the default zone */
  }
  tzCache.set(key, { tz, at: Date.now() });
  return tz;
}

export const outlookTimezonesAvailable = () => graphConfigured && !tzPermissionMissing;
