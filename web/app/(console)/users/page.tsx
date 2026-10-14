"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { ago, when } from "@/lib/format";
import { ConfirmButton, Empty, Skeleton } from "@/components/ui";
import { IconEdit, IconTrash, IconUsers } from "@/components/Icons";

type Role = "admin" | "staff";
type User = { id: string; username: string; role: Role; failedAttempts: number; blockedAt: string | null; blockedBy: string | null; lastLoginAt: string | null; createdAt: string };
type Data = { me: string; users: User[] };

function statusLine(u: User) {
  if (u.blockedAt) return u.blockedBy ? `Blocked by ${u.blockedBy} · ${when(u.blockedAt)}` : `Blocked ${when(u.blockedAt)} after ${u.failedAttempts} failed attempts`;
  const failed = u.failedAttempts ? ` · ${u.failedAttempts} failed attempt${u.failedAttempts > 1 ? "s" : ""}` : "";
  return `Last sign-in ${ago(u.lastLoginAt)}${failed}`;
}

function EditForm({ user, self, onDone }: { user: User; self: boolean; onDone: (saved: boolean) => void }) {
  const [username, setUsername] = useState(user.username);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user.role);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api(`/users/${user.id}`, { method: "PATCH", json: { username, role, ...(password ? { password } : {}) } });
      onDone(true);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="user-edit stack" onSubmit={save}>
      <div className="user-form">
        <label className="field">Username<input className="input" required autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label className="field">New password<input className="input" type="password" autoComplete="new-password" placeholder="Leave blank to keep" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label className="field">Role
          <select className="input" value={role} disabled={self} title={self ? "You can't change your own role" : undefined} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>
      {password && <p className="muted small" style={{ margin: 0 }}>Changing the password signs {self ? "you out on your other devices" : `${user.username} out everywhere`}.</p>}
      {err && <div className="alert small" role="alert">{err}</div>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn ghost" onClick={() => onDone(false)}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}

export default function UsersPage() {
  const { data, error, loading, reload } = useApi<Data>("/users", 15_000);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [addErr, setAddErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState("");

  if (loading && !data) return <div className="stack"><div className="card"><Skeleton h={90} /></div><div className="card"><Skeleton h={220} /></div></div>;
  if (!data) return <div className="alert">{error ?? "Could not load users."}</div>;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddErr("");
    try {
      await api("/users", { method: "POST", json: { username, password, role } });
      setUsername("");
      setPassword("");
      setRole("staff");
      await reload();
    } catch (err) {
      setAddErr((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function act(u: User, path: string, method = "POST") {
    setBusy(u.id);
    setActionErr("");
    try {
      await api(`/users/${u.id}${path}`, { method });
      await reload();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const blocked = data.users.filter((u) => u.blockedAt).length;

  return (
    <div className="stack">
      <div className="card reveal">
        <h2>Add user</h2>
        <form className="user-form" onSubmit={add}>
          <input className="input" required autoComplete="off" placeholder="Username" aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="input" required type="password" autoComplete="new-password" placeholder="Password (min 8 characters)" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <select className="input" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn primary" disabled={adding}>{adding ? "Adding…" : "Add"}</button>
        </form>
        {addErr && <div className="alert small" style={{ marginTop: 10 }}>{addErr}</div>}
      </div>

      <div className="card reveal" style={{ "--i": 1 } as React.CSSProperties}>
        <div className="row between wrap" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Accounts</h2>
          {blocked > 0 && <span className="pill down"><span className="dot idle" />{blocked} blocked</span>}
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Staff accounts are blocked after 3 wrong passwords in a row, or when an admin blocks them, and stay blocked until an admin unblocks them. Admin accounts can never be blocked. Only admins can see this page.
        </p>
        {actionErr && <div className="alert small" role="alert" style={{ marginBottom: 10 }}>{actionErr}</div>}
        {!data.users.length ? (
          <Empty icon={<IconUsers />} title="No accounts">Add a user above.</Empty>
        ) : (
          <div className="list">
            {data.users.map((u) => {
              const self = u.id === data.me;
              return (
                <div key={u.id} className="user-wrap">
                  <div className={`list-item recipient user-row ${u.blockedAt ? "off" : ""}`}>
                    <div className="avatar" aria-hidden>{u.username[0].toUpperCase()}</div>
                    <div className="truncate" style={{ flex: 1 }}>
                      <b>{u.username}</b> <span className="tag">{u.role}</span>{self && <span className="tag" style={{ marginLeft: 4 }}>you</span>}
                      <div className="muted small">{statusLine(u)}</div>
                    </div>
                    <div className="user-actions">
                      {u.blockedAt ? (
                        <button className="btn primary" disabled={busy === u.id} onClick={() => act(u, "/unblock")}>{busy === u.id ? "Unblocking…" : "Unblock"}</button>
                      ) : u.role === "staff" ? (
                        <ConfirmButton className="btn" confirmLabel="Block?" ariaLabel={`Block ${u.username}`} onConfirm={() => act(u, "/block")}>Block</ConfirmButton>
                      ) : null}
                      <button className="btn ghost icon-btn" aria-label={`Edit ${u.username}`} title="Edit" aria-expanded={editing === u.id} onClick={() => setEditing(editing === u.id ? null : u.id)}><IconEdit /></button>
                      {!self && (
                        <ConfirmButton className="btn ghost icon-btn" ariaLabel={`Delete ${u.username}`} confirmLabel="Delete?" onConfirm={() => act(u, "", "DELETE")}><IconTrash /></ConfirmButton>
                      )}
                    </div>
                  </div>
                  {editing === u.id && <EditForm user={u} self={self} onDone={(saved) => { setEditing(null); if (saved) reload(); }} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
