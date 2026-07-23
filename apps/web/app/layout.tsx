import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "easyTree",
  description: "easyTree — mandantenfähige Web-Shell (Sprint 1, EYT-41)",
  applicationName: "easyTree",
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
