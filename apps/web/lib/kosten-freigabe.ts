import { cookies, headers } from "next/headers";

import type { SessionOrganisation } from "@easytree/contracts";

import { ORG_AUSWAHL_COOKIE } from "./organisations-auswahl-cookie";
import { leseServerSitzung, type ServerSitzung } from "./sitzung-server";

/**
 * Serverseitige Kosten-Ladegrenze (EYT-113 Inkrement 2, PO-Entscheidung
 * 29.08.2026): massgeblich ist das verifizierte `costs.read` der AUSGEWAEHLTEN
 * Organisation. Die Selector-Id waehlt nur aus — verifiziert wird sie gegen
 * die real geprueften Mitgliedschaften der Session. Eine Any-Org-Pruefung
 * ist ausdruecklich verboten: Recht in Organisation A gewaehrt nichts,
 * solange Organisation B ausgewaehlt ist.
 *
 * Fail-closed: unbekannte Session, fremde/ungueltige Selector-Id, fehlende
 * Auswahl bei mehreren Organisationen und fehlendes Recht laden nichts.
 */
export type KostenFreigabe =
  | { art: "gewaehrt"; organisation: SessionOrganisation }
  | { art: "verboten"; organisation: SessionOrganisation }
  | { art: "keine-auswahl" }
  | { art: "abgemeldet" }
  | { art: "unbekannt" };

export function kostenFreigabe(sitzung: ServerSitzung, orgSelektor: string | null): KostenFreigabe {
  if (sitzung.zustand === "unbekannt") return { art: "unbekannt" };
  if (sitzung.zustand === "abgemeldet") return { art: "abgemeldet" };

  const orgs = sitzung.session.organisations;
  let organisation: SessionOrganisation | null = null;
  if (orgSelektor !== null && orgSelektor !== "") {
    // Eine Id, die NICHT in der Session steht, faellt ersatzlos — kein
    // Rueckfall auf die einzige Organisation, sonst wuerde ein fremder
    // Selector still uminterpretiert statt abgelehnt.
    organisation = orgs.find((org) => org.id === orgSelektor) ?? null;
  } else if (orgs.length === 1) {
    organisation = orgs[0] ?? null;
  }

  if (organisation === null) return { art: "keine-auswahl" };
  return organisation.permissions.includes("costs.read")
    ? { art: "gewaehrt", organisation }
    : { art: "verboten", organisation };
}

/**
 * Duenner Server-Einstieg: die EINZIGE Stelle, die die beiden
 * Anfrage-Eingaben (Cookie-Header fuer die Session, Auswahl-Cookie fuer den
 * Selector) liest. Beide Kosten-Seiten rufen genau diese Funktion.
 */
export async function leseKostenFreigabe(): Promise<KostenFreigabe> {
  const kopfzeilen = await headers();
  const keks = await cookies();
  const sitzung = await leseServerSitzung(kopfzeilen.get("cookie"));
  return kostenFreigabe(sitzung, keks.get(ORG_AUSWAHL_COOKIE)?.value ?? null);
}
