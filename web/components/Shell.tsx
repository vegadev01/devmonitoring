"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, useApi } from "@/lib/api";
import { IconAlert, IconApps, IconHome, IconLogout, IconMenu, IconServer } from "./Icons";

const NAV = [
  { href: "/", label: "Overview", Icon: IconHome },
  { href: "/apps", label: "Applications", Icon: IconApps },
  { href: "/servers", label: "Servers", Icon: IconServer },
  { href: "/incidents", label: "Incidents", Icon: IconAlert },
];

const TITLES: Record<string, string> = { "/": "Overview", "/apps": "Applications", "/servers": "Servers", "/incidents": "Incidents" };

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [ready, setReady] = useState(false);
  const { data: ov } = useApi<{ openIncidents: number; apps: { down: number } }>(ready ? "/overview" : null, 30_000);

  useEffect(() => {
    api("/auth/me").then(() => setReady(true)).catch(() => router.replace("/login"));
  }, [router]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 6);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  if (!ready) return <div className="login"><img src="/logo.svg" alt="" className="logo" style={{ width: 64, animation: "float 2s ease-in-out infinite" }} /></div>;

  const base = "/" + (path.split("/")[1] ?? "");
  const title = TITLES[base] ?? "DevMonitor";
  const bad = (ov?.openIncidents ?? 0) > 0;

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <img src="/logo.svg" alt="Veganext" />
          <div><b>DevMonitor</b><small>Veganext</small></div>
        </div>
        {NAV.map(({ href, label, Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} className={`nav-link ${active ? "active" : ""}`}>
              <Icon />{label}
              {href === "/incidents" && bad && <span className="nav-badge">{ov!.openIncidents}</span>}
            </Link>
          );
        })}
        <div className="sidebar-foot">
          <button className="nav-link" style={{ border: 0, background: "none", cursor: "pointer", width: "100%", font: "inherit" }}
            onClick={async () => { await api("/auth/logout", { method: "POST" }); router.replace("/login"); }}>
            <IconLogout />Sign out
          </button>
          <small className="muted" style={{ padding: "0 12px" }}>devmonitor.veganext.com</small>
        </div>
      </aside>
      <div className="main">
        <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
          <button className="btn ghost menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><IconMenu /></button>
          <h1>{title}</h1>
          <span className="spacer" />
          <span className="live"><span className={`dot ${bad ? "bad" : ""}`} />{bad ? `${ov!.openIncidents} open incident${ov!.openIncidents > 1 ? "s" : ""}` : "All systems nominal"}</span>
        </header>
        <main className="content page" key={path}>{children}</main>
      </div>
    </div>
  );
}
