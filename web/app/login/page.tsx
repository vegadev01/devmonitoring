"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/auth/login", { method: "POST", json: { username, password } });
      router.replace("/");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <img src="/logo.svg" alt="Veganext" className="logo" />
        <h1>DevMonitor</h1>
        <p className="sub">Sign in to the Veganext operations console</p>
        <div className="stack">
          <label className="field">Username<input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} required /></label>
          <label className="field">Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required /></label>
          {err && <div className="alert" role="alert">{err}</div>}
          <button className="btn primary" disabled={busy} style={{ padding: 12, marginTop: 4 }}>{busy ? "Signing in…" : "Sign in"}</button>
        </div>
      </form>
    </div>
  );
}
