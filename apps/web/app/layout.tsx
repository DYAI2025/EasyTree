import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "easyTree",
  description: "easyTree — mandantenfähige Web-Shell (Sprint 1, EYT-41)",
  applicationName: "easyTree",
  // Ohne deklariertes Icon fordert der Browser /favicon.ico an und
  // erhaelt 404 (Befund aus dem Browser-Smoke, EYT-58b) — deshalb das
  // vorhandene PWA-Icon auch als Favicon deklarieren.
  icons: { icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#166534",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
