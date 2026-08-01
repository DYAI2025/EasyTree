"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useSession } from "../lib/session-provider";

/**
 * Shell der Werkbank (Basisdesign v2.0 §3.1): kompakte Topbar, globale
 * Navigation, Organisations- und Benutzeranzeige. Skip-Link und Landmarks
 * bleiben aus Sprint 1 erhalten (EYT-41).
 *
 * Der Navigationspunkt „Kosten" erscheint AUSSCHLIESSLICH mit `costs.read`
 * aus der realen Session — und ersetzt trotzdem keine API-Autorisierung:
 * dieselbe Rechteliste steuert hier nur die Anzeige.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pfad = usePathname();
  const router = useRouter();
  const { sitzung, organisation, organisationWaehlen, hatRecht, abmelden } = useSession();

  const angemeldet = sitzung.zustand === "angemeldet";
  const organisationen = angemeldet ? sitzung.session.organisations : [];

  const navPunkte: Array<{ href: string; label: string }> = [
    { href: "/", label: "Start" },
    { href: "/planung", label: "Planung" },
    ...(hatRecht("costs.read") ? [{ href: "/kosten", label: "Kosten" }] : []),
  ];

  return (
    <>
      <a className="skip-link" href="#hauptinhalt">
        Zum Hauptinhalt springen
      </a>
      <header className="app-header">
        <span className="app-brand">easyTree</span>
        <nav aria-label="Hauptnavigation">
          <ul className="app-nav-list">
            {navPunkte.map((punkt) => (
              <li key={punkt.href}>
                <Link
                  href={punkt.href}
                  aria-current={
                    pfad === punkt.href || (punkt.href !== "/" && pfad.startsWith(punkt.href))
                      ? "page"
                      : undefined
                  }
                >
                  {punkt.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="app-session">
          {angemeldet ? (
            <>
              {organisationen.length > 1 ? (
                <label className="app-org-select">
                  <span className="app-org-select__label">Organisation</span>
                  <select
                    value={organisation?.id ?? ""}
                    onChange={(ereignis) => organisationWaehlen(ereignis.target.value)}
                  >
                    <option value="" disabled>
                      Bitte wählen
                    </option>
                    {organisationen.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="app-org-name">{organisation?.name ?? ""}</span>
              )}
              <button
                type="button"
                className="app-logout"
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
          )}
        </div>
      </header>
      <main id="hauptinhalt" tabIndex={-1} className="app-main">
        {children}
      </main>
      <footer className="app-footer">
        <p>easyTree — Arboscus Teamplaner</p>
      </footer>
    </>
  );
}
