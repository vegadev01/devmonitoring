import type { ReactNode, SVGProps } from "react";

const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const mk = (d: ReactNode) =>
  function Icon(p: SVGProps<SVGSVGElement>) {
    return <svg {...base} {...p}>{d}</svg>;
  };

export const IconHome = mk(<><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>);
export const IconApps = mk(<><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>);
export const IconServer = mk(<><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>);
export const IconAlert = mk(<><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18h.01" /></>);
export const IconPulse = mk(<path d="M3 12h4l3-8 4 16 3-8h4" />);
export const IconClock = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IconBolt = mk(<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />);
export const IconPlus = mk(<path d="M12 5v14M5 12h14" />);
export const IconRefresh = mk(<><path d="M20 11a8 8 0 10-2.3 5.7" /><path d="M20 4v7h-7" /></>);
export const IconLogout = mk(<><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>);
export const IconMenu = mk(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconX = mk(<path d="M6 6l12 12M18 6L6 18" />);
export const IconCheck = mk(<path d="M5 12.5l4.5 4.5L19 7" />);
export const IconExternal = mk(<><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></>);
export const IconSearch = mk(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export const IconTrash = mk(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>);
export const IconShield = mk(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></>);
export const IconArrowLeft = mk(<path d="M19 12H5M11 18l-6-6 6-6" />);
