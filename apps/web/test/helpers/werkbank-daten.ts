/**
 * Serverantworten fuer die Werkbanktests (EYT-140, Slice 1).
 *
 * ## Warum die Werte so auffaellig sind
 *
 * `docs/traceability.md`, `TRC-S6-003` haelt fest: eine Gegenmutation „Gateway
 * auf Fixture umbiegen" traegt nur, wenn die Fixturewerte sich NACHWEISBAR von
 * moeglichen Clientwerten unterscheiden. Deshalb tragen Ids, Namen und Zeiten
 * hier Werte, die kein Browser erfinden koennte: eine Zuweisung, deren Id nur
 * in dieser Antwort steht, und Namen, die als solche erkennbar sind.
 */
import type { PlanningWindow, SessionDto } from "@easytree/contracts";

export const ORG_ID = "11111111-1111-4111-8111-111111111111";
export const NUTZER_ID = "22222222-2222-4222-8222-222222222222";

export const PERSON_ID = "33333333-3333-4333-8333-333333333333";
export const BAUSTELLE_ID = "44444444-4444-4444-8444-444444444444";

/** Die Zuweisung, die der Server bereits kennt. */
export const EINSATZ_VOM_SERVER = "55555555-5555-4555-8555-555555555555";
/** Die Zuweisung, die der Server bei einem Schreibvorgang vergibt. */
export const EINSATZ_NEU_VOM_SERVER = "66666666-6666-4666-8666-666666666666";
/**
 * Eine Zuweisung, die WAEHREND des Schreibvorgangs von anderer Seite entstand.
 * Sie kann nur ueber ein erneutes Lesen sichtbar werden — nie aus der Antwort
 * des eigenen Schreibaufrufs.
 */
export const EINSATZ_FREMD = "77777777-7777-4777-8777-777777777777";

export const ENTWURF_VERSION = "88888888-8888-4888-8888-888888888888";
export const VEROEFFENTLICHTE_VERSION = "99999999-9999-4999-8999-999999999999";

export const ZONE = "Europe/Berlin";

export function sitzungMit(rechte: readonly string[]): SessionDto {
  return {
    userId: NUTZER_ID,
    organisations: [
      {
        id: ORG_ID,
        name: "Baumpflege Alpha",
        role: "owner",
        permissions: [...rechte],
      },
    ],
  };
}

const RESSOURCEN = {
  employees: [{ id: PERSON_ID, label: "Anna Serverstand", active: true }],
  worksites: [{ id: BAUSTELLE_ID, label: "Baustelle Nord (Serverstand)", active: true }],
} as const;

function einsatz(id: string, startUtc: string, endUtc: string) {
  return {
    id,
    employeeId: PERSON_ID,
    worksiteId: BAUSTELLE_ID,
    interval: { startUtc, endUtc },
  };
}

/** Woche ohne jede Planversion — der ehrliche Leerzustand. */
export function fensterLeer(weekKey: string): PlanningWindow {
  return {
    weekKey,
    timeZone: ZONE,
    assignments: [],
    sourceVersion: null,
    publishedVersionId: null,
    resources: { employees: [...RESSOURCEN.employees], worksites: [...RESSOURCEN.worksites] },
  };
}

/** Woche mit einem Entwurf und einer bereits gespeicherten Zuweisung. */
export function fensterMitEntwurf(
  weekKey: string,
  einsaetze: readonly { id: string; startUtc: string; endUtc: string }[] = [
    {
      id: EINSATZ_VOM_SERVER,
      startUtc: "2026-08-18T06:00:00.000Z",
      endUtc: "2026-08-18T14:00:00.000Z",
    },
  ],
): PlanningWindow {
  return {
    weekKey,
    timeZone: ZONE,
    assignments: einsaetze.map((e) => einsatz(e.id, e.startUtc, e.endUtc)),
    sourceVersion: { id: ENTWURF_VERSION, state: "draft" },
    publishedVersionId: null,
    resources: { employees: [...RESSOURCEN.employees], worksites: [...RESSOURCEN.worksites] },
  };
}

/** Woche, deren angezeigter Stand der veroeffentlichte ist. */
export function fensterVeroeffentlicht(weekKey: string): PlanningWindow {
  return {
    weekKey,
    timeZone: ZONE,
    assignments: [
      einsatz(EINSATZ_VOM_SERVER, "2026-08-18T06:00:00.000Z", "2026-08-18T14:00:00.000Z"),
    ],
    sourceVersion: { id: VEROEFFENTLICHTE_VERSION, state: "published" },
    publishedVersionId: VEROEFFENTLICHTE_VERSION,
    resources: { employees: [...RESSOURCEN.employees], worksites: [...RESSOURCEN.worksites] },
  };
}
