import { describe, expect, it } from "vitest";

import type { SessionOrganisation } from "@easytree/contracts";

import { kostenFreigabe } from "../lib/kosten-freigabe";
import type { ServerSitzung } from "../lib/sitzung-server";

/**
 * Pures Server-Gate `kostenFreigabe` (EYT-113 Inkrement 2, PO-Entscheidung
 * 29.08.2026): das Kostenrecht bleibt organisationsgebunden. Massgeblich ist
 * `costs.read` der AUSGEWAEHLTEN Organisation — die Selector-Id waehlt nur
 * aus und wird gegen die real verifizierte Session geprueft. Die
 * Aufweichung "Recht in IRGENDEINER Organisation genuegt" ist verboten.
 *
 * Gegenmutationen, die diese Suite rot machen: Any-Org-Pruefung
 * (`orgs.some(...)` statt der ausgewaehlten Organisation — Fall 7), Rueckfall
 * einer fremden Selector-Id auf die einzige Organisation (Fall 8), stilles
 * Auswaehlen der ersten von mehreren Organisationen (Fall 5), "unbekannt"
 * oder "abgemeldet" auf ein Ergebnis mit Organisation mappen (Faelle 1/2).
 */
function org(id: string, name: string, permissions: string[]): SessionOrganisation {
  return { id, name, role: "member", permissions };
}

function angemeldet(organisations: SessionOrganisation[]): ServerSitzung {
  return {
    zustand: "angemeldet",
    session: {
      userId: "00000000-0000-4000-8000-000000000001",
      organisations,
    },
  };
}

const MIT_RECHT = org("00000000-0000-4000-8000-00000000000a", "Baumpflege Nord", ["costs.read"]);
const OHNE_RECHT = org("00000000-0000-4000-8000-00000000000b", "Baumpflege Sued", []);
const FREMDE_ID = "00000000-0000-4000-8000-0000000000ff";

describe("kostenFreigabe (EYT-113)", () => {
  it("liefert 'unbekannt' bei unbekannter Session", () => {
    expect(kostenFreigabe({ zustand: "unbekannt" }, null)).toEqual({
      art: "unbekannt",
    });
  });

  it("liefert 'abgemeldet' bei abgemeldeter Session", () => {
    expect(kostenFreigabe({ zustand: "abgemeldet" }, null)).toEqual({
      art: "abgemeldet",
    });
  });

  it("gewaehrt bei genau einer Organisation MIT costs.read ohne Selector", () => {
    expect(kostenFreigabe(angemeldet([MIT_RECHT]), null)).toEqual({
      art: "gewaehrt",
      organisation: MIT_RECHT,
    });
  });

  it("verbietet bei genau einer Organisation OHNE costs.read ohne Selector", () => {
    expect(kostenFreigabe(angemeldet([OHNE_RECHT]), null)).toEqual({
      art: "verboten",
      organisation: OHNE_RECHT,
    });
  });

  it("liefert 'keine-auswahl' bei zwei Organisationen ohne Selector — kein stilles Auswaehlen", () => {
    expect(kostenFreigabe(angemeldet([MIT_RECHT, OHNE_RECHT]), null)).toEqual({
      art: "keine-auswahl",
    });
  });

  it("gewaehrt bei zwei Organisationen, wenn der Selector die MIT costs.read waehlt", () => {
    expect(kostenFreigabe(angemeldet([MIT_RECHT, OHNE_RECHT]), MIT_RECHT.id)).toEqual({
      art: "gewaehrt",
      organisation: MIT_RECHT,
    });
  });

  it("verbietet, wenn der Selector die Organisation OHNE costs.read waehlt, obwohl die ANDERE es hat (PO-Kern: keine Any-Org-Pruefung)", () => {
    expect(kostenFreigabe(angemeldet([MIT_RECHT, OHNE_RECHT]), OHNE_RECHT.id)).toEqual({
      art: "verboten",
      organisation: OHNE_RECHT,
    });
  });

  it("liefert 'keine-auswahl' bei fremder Selector-Id — kein Rueckfall auf die einzige Organisation", () => {
    expect(kostenFreigabe(angemeldet([MIT_RECHT]), FREMDE_ID)).toEqual({
      art: "keine-auswahl",
    });
  });

  it("behandelt Selector '' wie null: einzige Organisation gewaehrt, zwei Organisationen keine-auswahl", () => {
    expect(kostenFreigabe(angemeldet([MIT_RECHT]), "")).toEqual({
      art: "gewaehrt",
      organisation: MIT_RECHT,
    });
    expect(kostenFreigabe(angemeldet([MIT_RECHT, OHNE_RECHT]), "")).toEqual({
      art: "keine-auswahl",
    });
  });
});
