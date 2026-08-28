"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell as UiAppShell } from "@easytree/ui";

import { useSession } from "../../lib/session-provider";

/**
 * Shell der Feld-App (EYT-113, Basisdesign v2.0): mobile-first Rahmen fuer
 * Mitarbeitende im Einsatz. Dasselbe domaenenfreie Geruest wie die Werkbank
 * (`@easytree/ui` AppShell), aber eine EIGENE Informationsarchitektur:
 *
 * - KEINE Werkbank-Navigation. Die Feld-App bekommt erst dann Navigations-
 *   punkte, wenn die Ziele real existieren (EYT-81) — ein Punkt ohne
 *   funktionierendes Ziel waere eine Attrappe. Der Slot bleibt deshalb leer,
 *   und `test/feld-shell.test.tsx` haelt fest, dass hier keine Links auf
 *   /planung oder /kosten stehen.
 * - Sitzungsbereich: Organisation und Abmelden — echte Session, echter
 *   Logout, sonst nichts.
 *
 * Import-Grenze: diese Datei und alles unter `components/feld/` darf keine
 * Werkbank-Komponenten importieren — Regel `feld-shell-boundary` in
 * `apps/api/test/architecture/rules.ts` macht einen Verstoss rot.
 */
export function FeldShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { sitzung, organisation, abmelden } = useSession();
  const angemeldet = sitzung.zustand === "angemeldet";

  const sitzungsbereich = angemeldet ? (
    <>
      {organisation === null ? null : (
        <span className="app-org-name" data-testid="feld-org">
          {organisation.name}
        </span>
      )}
      <button
        type="button"
        className="app-logout"
        data-testid="feld-abmelden"
        onClick={() => {
          void abmelden().then(() => router.push("/anmelden"));
        }}
      >
        Abmelden
      </button>
    </>
  ) : (
    <Link href="/anmelden" className="app-login-link">
      Anmelden
    </Link>
  );

  return (
    <UiAppShell
      skipLinkLabel="Zum Hauptinhalt springen"
      brand={
        <span data-testid="feld-shell">
          easyTree <span className="feld-marke">Feld</span>
        </span>
      }
      sessionArea={sitzungsbereich}
    >
      {children}
    </UiAppShell>
  );
}
