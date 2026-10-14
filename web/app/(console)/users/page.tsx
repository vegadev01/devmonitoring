"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { ago, when } from "@/lib/format";
import { Empty, Skeleton } from "@/components/ui";
import { IconUsers } from "@/components/Icons";

type User = { id: string; username: string; role: "admin" | "staff"; failedAttempts: number; blockedAt: string | null; lastLoginAt: string | null; createdAt: string };

export default function UsersPage() {
  const { data, error, loading, reload } = useApi<User[]>("/users", 15_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState("");

  if (loading && !data) return <div className="card"><Skeleton h={180} /></div>;
  if (!data) return <div className="alert">{error ?? "Could not load users."}</div>;

  async function unblock(u: User) {
    setBusy(u.id);
    setActionErr("");
    try {
      await api(`/users/${u.id}/unblock`, { method: "POST" });
      await reload();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const blocked = data.filter((u) => u.blockedAt).length;

  return (
    <div className="stack">
      <div className="card reveal">
        <div className="row between wrap" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Console accounts</h2>
          {blocked > 0 && <span className="pill down"><span className="dot idle" />{blocked} blocked</span>}
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Staff accounts are blocked after 3 wrong passwords in a row and stay blocked until an admin unblocks them here. Admin accounts are never blocked.
        </p>
        {actionErr && <div className="alert" role="alert" style={{ marginBottom: 10 }}>{actionErr}</div>}
        {!data.length ? (
          <Empty icon={<IconUsers />} title="No accounts">Set ADMIN_USER / STAFF_USER and their password hashes in .env, then restart the API.</Empty>
        ) : (
          <div className="list">
            {data.map((u) => (
              <div className={`list-item recipient ${u.blockedAt ? "off" : ""}`} key={u.id}>
                <div className="avatar" aria-hidden>{u.username[0].toUpperCase()}</div>
                <div className="truncate" style={{ flex: 1 }}>
                  <b>{u.username}</b> <span className="tag">{u.role}</span>
                  <div className="muted small">
                    {u.blockedAt
                      ? `Blocked ${when(u.blockedAt)} after ${u.failedAttempts} failed attempts`
                      : `Last sign-in ${ago(u.lastLoginAt)}${u.failedAttempts ? ` · ${u.failedAttempts} failed attempt${u.failedAttempts > 1 ? "s" : ""}` : ""}`}
                  </div>
                </div>
                {u.blockedAt ? (
                  <button className="btn primary" disabled={busy === u.id} onClick={() => unblock(u)}>{busy === u.id ? "Unblocking…" : "Unblock"}</button>
                ) : (
                  <span className={`pill ${u.role === "admin" ? "online" : "up"}`}><span className="dot idle" style={{ background: "var(--ok)" }} />Active</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
