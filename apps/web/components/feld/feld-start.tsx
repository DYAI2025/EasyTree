"use client";

import Link from "next/link";

import { EmptyState, ErrorState, LoadingState } from "@easytree/ui";

import { useSession } from "../../lib/session-provider";

/**
 * Startflaeche der Feld-App (EYT-113): zeigt ausschliesslich REALE
 * Sessiondaten — Organisation(en) und Rolle aus der serverseitig
 * aufgeloesten Session. Fachliche Feld-Ansichten (Einsaetze, Zeiten)
 * existieren noch nicht und werden deshalb weder verlinkt noch angedeutet;
 * der Leerzustand benennt die Abwesenheit ehrlich (gemeinsamer
 * Zustandsvertrag aus `@easytree/ui`, Basisdesign v2.0 §4).
 */
const ROLLENNAMEN: Readonly<Record<string, string>> = {
  owner: "Inhaber",
  manager: "Leitung",
  member: "Mitarbeiter",
};

export function FeldStart() {
  const { sitzung, neuLaden } = useSession();

  if (sitzung.zustand === "laedt") {
    return <LoadingState label="Sitzung wird geladen …" data-testid="feld-laedt" />;
  }

  if (sitzung.zustand === "fehler") {
    return (
      <ErrorState
        data-testid="feld-start-fehler"
        title="Sitzung nicht prüfbar"
        description="Die Anmeldung konnte gerade nicht geprüft werden."
        onRetry={neuLaden}
        retryLabel="Erneut versuchen"
      />
    );
  }

  if (sitzung.zustand === "abgemeldet") {
    // Das Server-Gate in `app/feld/layout.tsx` leitet Abgemeldete bereits
    // um; dieser Zweig faengt den Fall ab, dass die Sitzung NACH dem
    // Seitenaufbau ablaeuft — fail-closed statt eingefrorener Ansicht.
    return (
      <EmptyState
        data-testid="feld-unauthenticated"
        title="Nicht angemeldet"
        description="Deine Sitzung ist abgelaufen."
        action={
          <Link className="app-login-link" href="/anmelden">
            Anmelden
          </Link>
        }
      />
    );
  }

  const organisationen = sitzung.session.organisations;
  if (organisationen.length === 0) {
    return (
      <EmptyState
        data-testid="feld-ohne-organisation"
        title="Keinem Betrieb zugeordnet"
        description="Dein Konto gehört noch keiner Organisation an. Wende dich an deine Einsatzleitung."
      />
    );
  }

  return (
    <div className="feld-start" data-testid="feld-start">
      <ul className="feld-organisationen" data-testid="feld-organisationen">
        {organisationen.map((organisation) => (
          <li key={organisation.id} className="feld-organisation">
            <span className="feld-organisation__name">{organisation.name}</span>
            <span className="feld-organisation__rolle" data-testid="feld-rolle">
              {ROLLENNAMEN[organisation.role] ?? organisation.role}
            </span>
          </li>
        ))}
      </ul>
      <EmptyState
        data-testid="feld-keine-ansichten"
        title="Noch keine Feld-Ansichten"
        description="Einsätze und Zeiten stehen in der Feld-App noch nicht bereit."
      />
    </div>
  );
}
