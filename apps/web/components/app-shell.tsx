"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell as UiAppShell } from "@easytree/ui";

import { useSession } from "../lib/session-provider";

/**
 * Shell der Werkbank (Basisdesign v2.0 §3.1): kompakte Topbar, globale
 * Navigation, Organisations- und Benutzeranzeige. Skip-Link und Landmarks
 * bleiben aus Sprint 1 erhalten (EYT-41).
 *
 * Der Navigationspunkt „Kosten" erscheint AUSSCHLIESSLICH mit `costs.read`
 * aus der realen Session — und ersetzt trotzdem keine API-Autorisierung:
 * dieselbe Rechteliste steuert hier nur die Anzeige.
 *
 * Seit EYT-80 kommt das GERUEST aus `@easytree/ui`: Sprunganker, Kopfleiste,
 * Hauptbereich und Fusszeile stellt der Rahmen, nicht mehr diese Datei. Was
 * die Slots FUELLT, wird weiterhin hier gerendert — `nav`, `ul`, `label`,
 * `select`, `button`, `Link` und `p` stehen unveraendert unten. Was hier
 * bleibt, ist genau das, was dort nicht hingehoert: Sitzung, Rechtefilter,
 * Organisationswahl, Abmelden und der Router.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pfad = usePathname();
  const router = useRouter();
  const { sitzung, organisation, organisationWaehlen, hatRecht, abmelden } = useSession();

  const angemeldet = sitzung.zustand === "angemeldet";
  const organisationen = angemeldet ? sitzung.session.organisations : [];

  const navPunkte: Array<{ href: string; label: string }> = [
    { href: "/", label: "Start" },
    // Seit EYT-107 gefiltert: bis dahin stand „Planung" unbedingt in der
    // Navigation, waehrend die API jede Planungsanfrage mit 401/403
    // beantwortete — ein Link, der fuer niemanden funktionierte. Basisdesign
    // v2.0 §3.1: „Die Navigation wird serverseitig nach atomaren Rechten
    // gefiltert. Ein sichtbarer Navigationspunkt ersetzt keine
    // Autorisierung." Beides gilt: gefiltert wird hier, entschieden dort.
    ...(hatRecht("planning.read") ? [{ href: "/planung", label: "Planung" }] : []),
    ...(hatRecht("costs.read") ? [{ href: "/kosten", label: "Kosten" }] : []),
  ];

  // Der Sitzungsbereich steht als benannter Wert vor dem `return` und nicht
  // als 38-zeiliger Ausdruck an der Prop: eine Fallunterscheidung mit einer
  // zweiten darin, zwei `.map` und ein Klick-Handler lesen sich auf
  // Prop-Einrueckung nicht mehr als Struktur.
  const sitzungsbereich = angemeldet ? (
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
  );

  return (
    <UiAppShell
      skipLinkLabel="Zum Hauptinhalt springen"
      brand="easyTree"
      navigation={
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
      }
      sessionArea={sitzungsbereich}
      footer={<p>easyTree — Arboscus Teamplaner</p>}
    >
      {children}
    </UiAppShell>
  );
}
