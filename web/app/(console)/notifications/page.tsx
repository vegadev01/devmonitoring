"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { when } from "@/lib/format";
import { ConfirmButton, Empty, Skeleton } from "@/components/ui";
import { IconBell, IconCheck, IconTrash } from "@/components/Icons";

type Effective = { tz: string; source: "manual" | "outlook" | "default" };
type Recipient = { id: string; email: string; name: string | null; enabled: boolean; timezone: string | null; effective: Effective };
type LogRow = { id: string; event: string; subject: string; service: string; recipient: string; status: "sent" | "failed" | "skipped"; attempts: number; error: string | null; createdAt: string };
type Data = {
  mail: { configured: boolean; provider: "graph" | "smtp" | null; label: string; from: string };
  defaultTimezone: string;
  outlookTimezones: boolean;
  recipients: Recipient[];
  envRecipients: { email: string; effective: Effective }[];
  log: LogRow[];
};
type TestResult = { configured: boolean; results: { recipient: string; status: string; attempts: number; error?: string }[] };

const SOURCE_LABEL = { manual: "set manually", outlook: "from Outlook", default: "default" };
const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Africa/Tunis", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata"];
  }
})();

const EVENT_LABEL: Record<string, string> = {
  app_down: "App down", app_recovered: "App recovered", server_offline: "Server offline",
  server_recovered: "Server online", system_error: "System error", test: "Test",
};
const EVENT_TONE: Record<string, string> = { app_down: "bad", server_offline: "bad", system_error: "bad", app_recovered: "ok", server_recovered: "ok", test: "info" };

const TRIGGERS = [
  ["Application down", "after 2 consecutive failed health checks"],
  ["Application recovered", "first successful check after an outage, with total downtime"],
  ["Server offline", "agent stops reporting for longer than the offline threshold"],
  ["Server back online", "agent reports again, with time offline"],
  ["Monitoring system error", "the check loop itself fails (max once per hour)"],
];

export default function NotificationsPage() {
  const { data, loading, reload } = useApi<Data>("/notifications", 15_000);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [addErr, setAddErr] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testErr, setTestErr] = useState("");
  const [logFilter, setLogFilter] = useState<"all" | "failed">("all");

  if (loading && !data) return <div className="stack"><div className="card"><Skeleton h={90} /></div><div className="card"><Skeleton h={260} /></div></div>;
  if (!data) return <div className="alert">Could not load notification settings.</div>;

  const active = data.recipients.filter((r) => r.enabled).length + data.envRecipients.length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAddErr("");
    try {
      await api("/notifications/recipients", { method: "POST", json: { email, name } });
      setEmail("");
      setName("");
      reload();
    } catch (err) {
      setAddErr((err as Error).message);
    }
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    setTesting(true);
    setTest(null);
    setTestErr("");
    try {
      setTest(await api<TestResult>("/notifications/test", { method: "POST", json: { to: testTo.trim() } }));
      reload();
    } catch (err) {
      setTestErr((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function setZone(r: Recipient, timezone: string) {
    await api(`/notifications/recipients/${r.id}`, { method: "PATCH", json: { timezone } });
    reload();
  }

  // Rows from one alert share subject + timestamp (written in a single insert): show one line per alert.
  const groups = new Map<string, LogRow[]>();
  for (const l of data.log) {
    const k = `${l.createdAt}|${l.subject}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const log = [...groups.values()].filter((g) => logFilter === "all" || g.some((l) => l.status !== "sent"));

  return (
    <div className="stack">
      <div className="card reveal">
        <div className="row between wrap" style={{ gap: 16, alignItems: "flex-start" }}>
          <div className="row" style={{ gap: 14, alignItems: "flex-start", minWidth: 0 }}>
            <div className={`icon-chip ${data.mail.configured ? "ok" : "bad"}`} style={{ width: 48, height: 48 }}><IconBell /></div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 19, color: "var(--text)", margin: 0, letterSpacing: "-0.01em" }}>Email alerts {data.mail.configured ? "are active" : "are not being delivered"}</h2>
              <p className="muted small" style={{ marginTop: 3 }}>
                {data.mail.configured
                  ? <>Sending as <b>{data.mail.from}</b> via {data.mail.label} to {active} admin{active === 1 ? "" : "s"}. Each person sees times in their own time zone.</>
                  : <>Issues are detected and logged, but no email can be sent until Microsoft 365 is connected in the server&apos;s <span className="mono">.env</span>.</>}
              </p>
            </div>
          </div>
          <form className="test-form" onSubmit={sendTest}>
            <input className="input" list="test-recipients" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={`All ${active} recipients`} aria-label="Send test to" />
            <datalist id="test-recipients">{data.recipients.map((r) => <option key={r.id} value={r.email} />)}</datalist>
            <button className="btn primary" disabled={testing || (!active && !testTo)}>{testing ? "Sending…" : "Send test email"}</button>
          </form>
        </div>
        {!data.mail.configured && (
          <div className="alert warn" style={{ marginTop: 16 }}>
            Add <span className="mono">GRAPH_TENANT_ID</span>, <span className="mono">GRAPH_CLIENT_ID</span>, <span className="mono">GRAPH_CLIENT_SECRET</span> and <span className="mono">MAIL_FROM</span> (Azure app registration with the <b>Mail.Send</b> permission) to <span className="mono">.env</span>, then re-run <span className="mono">./deploy.sh</span>.
          </div>
        )}
        {testErr && <div className="alert" style={{ marginTop: 16 }}>{testErr}</div>}
        {test && (
          <div className="test-results">
            {test.results.map((r) => (
              <div key={r.recipient} className={`ping-result ${r.status === "sent" ? "ok" : "bad"}`}>
                <b>{r.status === "sent" ? "Delivered" : r.status === "skipped" ? "Skipped" : "Failed"}</b>
                <span>{r.recipient}</span>
                {r.attempts > 1 && <span>{r.attempts} attempts</span>}
                {r.error && <span>{r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid two">
        <div className="card reveal" style={{ "--i": 1 } as React.CSSProperties}>
          <h2>Admin recipients · {active} active</h2>
          <form className="add-recipient" onSubmit={add}>
            <input className="input" type="email" required placeholder="name@veganext.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="input" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn primary">Add</button>
          </form>
          {addErr && <div className="alert small" style={{ marginTop: 10 }}>{addErr}</div>}
          <div className="list" style={{ marginTop: 8 }}>
            {data.recipients.map((r) => (
              <div className={`list-item recipient ${r.enabled ? "" : "off"}`} key={r.id}>
                <div className="avatar" aria-hidden>{r.email[0].toUpperCase()}</div>
                <div className="truncate" style={{ flex: 1 }}>
                  <b className="truncate" style={{ display: "block" }}>{r.name || r.email}</b>
                  {r.name && <div className="muted small truncate">{r.email}</div>}
                  <select className="tz-select" value={r.timezone ?? ""} onChange={(e) => setZone(r, e.target.value)} aria-label={`Time zone for ${r.email}`} title="Time zone used for this person's alert emails">
                    <option value="">🕒 Auto · {r.timezone ? "" : `${r.effective.tz} (${SOURCE_LABEL[r.effective.source]})`}</option>
                    {ZONES.map((z) => <option key={z} value={z}>🕒 {z}</option>)}
                  </select>
                </div>
                <label className="switch" title={r.enabled ? "Receiving alerts" : "Paused"}>
                  <input type="checkbox" checked={r.enabled} aria-label={`Alerts for ${r.email}`} onChange={async (e) => { await api(`/notifications/recipients/${r.id}`, { method: "PATCH", json: { enabled: e.target.checked } }); reload(); }} />
                  <span />
                </label>
                <ConfirmButton className="btn ghost icon-btn" ariaLabel={`Remove ${r.email}`} confirmLabel="Remove?" onConfirm={async () => { await api(`/notifications/recipients/${r.id}`, { method: "DELETE" }); reload(); }}><IconTrash /></ConfirmButton>
              </div>
            ))}
            {data.envRecipients.map((e) => (
              <div className="list-item recipient" key={e.email}>
                <div className="avatar" aria-hidden>{e.email[0].toUpperCase()}</div>
                <div className="truncate" style={{ flex: 1 }}><b>{e.email}</b><div className="muted small">🕒 {e.effective.tz} ({SOURCE_LABEL[e.effective.source]})</div></div>
                <span className="tag" title="Set via ALERT_TO_EMAIL in .env">from .env</span>
              </div>
            ))}
            {!data.recipients.length && !data.envRecipients.length && <Empty icon={<IconBell />} title="No recipients">Add at least one admin to receive alerts.</Empty>}
          </div>
        </div>

        <div className="card reveal" style={{ "--i": 2 } as React.CSSProperties}>
          <h2>What sends an email</h2>
          <div className="list">
            {TRIGGERS.map(([t, d]) => (
              <div className="list-item" key={t} style={{ alignItems: "flex-start" }}>
                <div className="icon-chip" style={{ width: 30, height: 30, borderRadius: 9 }}><IconCheck style={{ width: 15, height: 15 }} /></div>
                <div><b style={{ fontSize: 14 }}>{t}</b><div className="muted small">{d}</div></div>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>Each email includes the issue type, affected service, endpoint, timestamp and error details, with a link back here. Failed sends are retried automatically.</p>
          <p className="muted small" style={{ marginTop: 8 }}>
            <b>Time zones:</b> {data.outlookTimezones ? "each admin's Outlook time zone is used automatically" : `automatic zones use ${data.defaultTimezone} until Microsoft 365 is connected with the MailboxSettings.Read permission`}. Pick a zone next to a person to override it. UTC is always shown alongside.
          </p>
        </div>
      </div>

      <div className="card reveal" style={{ "--i": 3 } as React.CSSProperties}>
        <div className="row between wrap" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Delivery log</h2>
          <div className="seg">
            <button className={logFilter === "all" ? "on" : ""} onClick={() => setLogFilter("all")}>All</button>
            <button className={logFilter === "failed" ? "on" : ""} onClick={() => setLogFilter("failed")}>Not delivered</button>
          </div>
        </div>
        {!log.length ? (
          <Empty icon={<IconBell />} title={logFilter === "all" ? "No notifications yet" : "Every notification was delivered"}>{logFilter === "all" ? "Alerts appear here as soon as an issue is detected — or send a test email." : "Nothing failed or was skipped."}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="log-table">
              <thead><tr><th>Time</th><th>Event</th><th>Service</th><th>Delivery</th></tr></thead>
              <tbody>
                {log.map((g) => {
                  const first = g[0];
                  const sent = g.filter((l) => l.status === "sent").length;
                  const tone = sent === g.length ? "sent" : g.every((l) => l.status === "skipped") ? "skipped" : "failed";
                  return (
                    <tr key={first.id}>
                      <td className="nowrap muted">{when(first.createdAt)}</td>
                      <td><span className={`code-chip ${EVENT_TONE[first.event] ?? "info"}`}>{EVENT_LABEL[first.event] ?? first.event}</span></td>
                      <td className="truncate-cell" title={first.subject}>{first.service}</td>
                      <td>
                        <details className="delivery">
                          <summary><span className={`status-text ${tone}`}>{sent}/{g.length} delivered</span></summary>
                          <ul>
                            {g.map((l) => (
                              <li key={l.id}>
                                <span className={`status-text ${l.status}`}>{l.status === "sent" ? "✓" : l.status === "skipped" ? "–" : "✕"}</span>
                                <span>{l.recipient}</span>
                                {l.attempts > 1 && <span className="muted">{l.attempts} attempts</span>}
                                {l.error && <span className="muted log-err" title={l.error}>{l.error}</span>}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
