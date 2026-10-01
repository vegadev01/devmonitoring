import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DevMonitor · Veganext", template: "%s · DevMonitor" },
  description: "Live health and resource monitoring for every Veganext application.",
  icons: { icon: "/logo.svg" },
};
export const viewport: Viewport = { themeColor: "#0f4a66", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
