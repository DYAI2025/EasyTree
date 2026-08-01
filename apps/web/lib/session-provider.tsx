"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { SessionDto, SessionOrganisation } from "@easytree/contracts";

import { useAuthGateway } from "./auth-gateway-provider";

/**
 * Sitzungszustand der ganzen App (EYT-106).
 *
 * Quelle ist AUSSCHLIESSLICH `GET /auth/session` ueber das AuthGateway —
 * kein LocalStorage, kein Mock, keine abgeleitete Wahrheit. `laedt` ist das
 * Warten auf die erste Antwort; `fehler` heisst: der Zustand ist UNBEKANNT
 * (Netz/Server), nicht "abgemeldet" — die UI unterscheidet das sichtbar.
 */
export type SessionZustand =
  | { zustand: "laedt" }
  | { zustand: "abgemeldet" }
  | { zustand: "fehler" }
  | { zustand: "angemeldet"; session: SessionDto };

export interface SessionContextValue {
  readonly sitzung: SessionZustand;
  /** Die AUSGEWAEHLTE Organisation — null, solange keine eindeutig ist. */
  readonly organisation: SessionOrganisation | null;
  readonly organisationWaehlen: (id: string) => void;
  /** Rechteprüfung fuer die ANZEIGE. Autorisiert nichts — das tut die API. */
  readonly hatRecht: (recht: string) => boolean;
  readonly neuLaden: () => void;
  readonly abmelden: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
  onOrganisationChange,
}: {
  children: ReactNode;
  /**
   * Meldet die ausgewaehlte Organisation an die Kompositionswurzel, damit
   * das CostsGateway den Auswahlheader setzen kann — ohne dass Komponenten
   * je einen Header sehen.
   */
  onOrganisationChange?: (id: string | null) => void;
}) {
  const gateway = useAuthGateway();
  const [sitzung, setSitzung] = useState<SessionZustand>({ zustand: "laedt" });
  const [gewaehlteOrgId, setGewaehlteOrgId] = useState<string | null>(null);
  const [ladelauf, setLadelauf] = useState(0);

  useEffect(() => {
    let abgebrochen = false;
    void gateway.session().then((ergebnis) => {
      if (abgebrochen) return;
      if (ergebnis.ok) {
        setSitzung({ zustand: "angemeldet", session: ergebnis.value });
        return;
      }
      // UNAUTHENTICATED ist eine klare Auskunft; alles andere ist Nichtwissen.
      setSitzung(
        ergebnis.failure === "UNAUTHENTICATED" ? { zustand: "abgemeldet" } : { zustand: "fehler" },
      );
    });
    return () => {
      abgebrochen = true;
    };
  }, [gateway, ladelauf]);

  const organisation = useMemo<SessionOrganisation | null>(() => {
    if (sitzung.zustand !== "angemeldet") return null;
    const orgs = sitzung.session.organisations;
    if (orgs.length === 1) return orgs[0] ?? null;
    // Mehrere aktive Organisationen: KEINE stille Auswahl (PO-Entscheidung).
    return orgs.find((org) => org.id === gewaehlteOrgId) ?? null;
  }, [sitzung, gewaehlteOrgId]);

  useEffect(() => {
    onOrganisationChange?.(organisation?.id ?? null);
  }, [organisation, onOrganisationChange]);

  const wert = useMemo<SessionContextValue>(
    () => ({
      sitzung,
      organisation,
      organisationWaehlen: (id) => setGewaehlteOrgId(id),
      hatRecht: (recht) => organisation?.permissions.includes(recht) ?? false,
      neuLaden: () => setLadelauf((lauf) => lauf + 1),
      abmelden: async () => {
        await gateway.logout();
        setGewaehlteOrgId(null);
        setSitzung({ zustand: "abgemeldet" });
      },
    }),
    [sitzung, organisation, gateway],
  );

  return <SessionContext.Provider value={wert}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const wert = useContext(SessionContext);
  if (wert === null) {
    throw new Error(
      "useSession: kein SessionProvider gefunden. Die einzige Konstruktionsstelle ist app/providers.tsx.",
    );
  }
  return wert;
}
