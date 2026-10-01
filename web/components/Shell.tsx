"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, useApi } from "@/lib/api";
import { IconAlert, IconApps, IconBolt, IconHome, IconLogout, IconServer, IconSidebar } from "./Icons";

const NAV = [
  { href: "/", label: "Overview", Icon: IconHome },
  { href: "/apps", label: "Applications", Icon: IconApps },
  { href: "/servers", label: "Servers", Icon: IconServer },
  { href: "/incidents", label: "Incidents", Icon: IconAlert },
  { href: "/studio", label: "API Studio", Icon: IconBolt },
];
const COLLAPSE_KEY = "dm.sidebar.collapsed";

const TITLES: Record<string, string> = { "/": "Overview", "/apps": "Applications", "/servers": "Servers", "/incidents": "Incidents", "/studio": "API Studio" };

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop rail
  const [scrolled, setScrolled] = useState(false);
  const [ready, setReady] = useState(false);
  const { data: ov } = useApi<{ openIncidents: number; apps: { down: number } }>(ready ? "/overview" : null, 30_000);

  useEffect(() => {
    api("/auth/me").then(() => setReady(true)).catch(() => router.replace("/login"));
  }, [router]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* storage unavailable */ }
  }, []);

  // One button: collapses/expands the sidebar on desktop, slides the drawer on mobile.
  const toggleSidebar = () => {
    if (window.matchMedia("(max-width: 860px)").matches) return setOpen((o) => !o);
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* storage unavailable */ }
      return !c;
    });
  };
  useEffect(() => {
    // Ctrl/Cmd + B toggles the sidebar, like most editors.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b" && !(e.target as HTMLElement)?.closest("input, textarea, select")) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
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
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <img src="/logo.svg" alt="Veganext" />
          <div className="brand-text"><b>DevMonitor</b><small>Veganext</small></div>
        </div>
        {NAV.map(({ href, label, Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} className={`nav-link ${active ? "active" : ""}`} title={collapsed ? label : undefined} aria-label={label}>
              <Icon /><span className="nav-label">{label}</span>
              {href === "/incidents" && bad && <span className="nav-badge">{ov!.openIncidents}</span>}
            </Link>
          );
        })}
        <div className="sidebar-foot">
          <button className="nav-link" style={{ border: 0, background: "none", cursor: "pointer", width: "100%", font: "inherit" }} title={collapsed ? "Sign out" : undefined}
            onClick={async () => { await api("/auth/logout", { method: "POST" }); router.replace("/login"); }}>
            <IconLogout /><span className="nav-label">Sign out</span>
          </button>
          <small className="muted sidebar-host">devmonitor.veganext.com</small>
        </div>
      </aside>
      <div className="main">
        <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
          <button className="btn ghost sidebar-toggle" onClick={toggleSidebar} aria-label={collapsed || !open ? "Toggle sidebar" : "Close sidebar"} aria-expanded={!collapsed} title="Toggle sidebar (Ctrl+B)"><IconSidebar /></button>
          <h1>{title}</h1>
          <span className="spacer" />
          <span className="live"><span className={`dot ${bad ? "bad" : ""}`} />{bad ? `${ov!.openIncidents} open incident${ov!.openIncidents > 1 ? "s" : ""}` : "All systems nominal"}</span>
        </header>
        <main className="content page" key={path}>{children}</main>
      </div>
    </div>
  );
}
