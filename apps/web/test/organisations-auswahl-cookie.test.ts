/**
 * Selector-Cookie der Organisationsauswahl (EYT-113 Inkrement 2).
 *
 * jsdoms document.cookie zeigt beim Lesen keine Attribute; die
 * Attributzusicherung laeuft deshalb ueber einen Spy auf dem
 * cookie-Setter, der die volle geschriebene Zeile sieht.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  ORG_AUSWAHL_COOKIE,
  liesOrgAuswahl,
  liesOrgAuswahlAusDokument,
  schreibeOrgAuswahl,
} from "../lib/organisations-auswahl-cookie";

describe("liesOrgAuswahl", () => {
  it("liefert null fuer fehlenden oder leeren Header", () => {
    expect(liesOrgAuswahl(null)).toBeNull();
    expect(liesOrgAuswahl("")).toBeNull();
  });

  it("liefert null, wenn das Cookie im Header fehlt", () => {
    expect(liesOrgAuswahl("eyt_access=abc; other=1")).toBeNull();
  });

  it("findet das Cookie zwischen anderen", () => {
    expect(
      liesOrgAuswahl("eyt_access=abc; eyt_org=00000000-0000-4000-8000-00000000e201; x=1"),
    ).toBe("00000000-0000-4000-8000-00000000e201");
  });

  it("liefert null fuer einen leeren Wert", () => {
    expect(liesOrgAuswahl("eyt_org=")).toBeNull();
  });

  it("dekodiert URL-kodierte Werte", () => {
    // Gegenmutation: decodeURIComponent weglassen -> rot.
    expect(liesOrgAuswahl("eyt_org=a%20b%2Fc")).toBe("a b/c");
  });

  it("verlangt den exakten Namen — ein Suffixtreffer zaehlt nicht", () => {
    // Gegenmutation: Namensvergleich auf endsWith umstellen -> rot.
    expect(liesOrgAuswahl("xeyt_org=evil")).toBeNull();
  });
});

describe("Dokument-Funktionen", () => {
  afterEach(() => {
    // jsdom haelt document.cookie ueber alle Tests dieser Datei hinweg.
    document.cookie = `${ORG_AUSWAHL_COOKIE}=; path=/; Max-Age=0`;
  });

  it("schreibt die Auswahl und liest sie zurueck", () => {
    schreibeOrgAuswahl("abc-id");
    expect(document.cookie).toContain(`${ORG_AUSWAHL_COOKIE}=abc-id`);
    expect(liesOrgAuswahlAusDokument()).toBe("abc-id");
  });

  it("loescht die Auswahl mit null", () => {
    schreibeOrgAuswahl("abc-id");
    schreibeOrgAuswahl(null);
    expect(liesOrgAuswahlAusDokument()).toBeNull();
  });

  it("schreibt path=/ und SameSite=Lax, Loeschung zusaetzlich Max-Age=0", () => {
    // Gegenmutation: eines der Attribute in schreibeOrgAuswahl streichen -> rot.
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    if (!original?.get || !original.set) {
      throw new Error("jsdom ohne cookie-Accessor — Spy nicht moeglich");
    }
    const liesRoh = original.get;
    const schreibeRoh = original.set;
    const geschrieben: string[] = [];
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get(): string {
        return liesRoh.call(document) as string;
      },
      set(wert: string) {
        geschrieben.push(wert);
        schreibeRoh.call(document, wert);
      },
    });
    try {
      schreibeOrgAuswahl("abc-id");
      schreibeOrgAuswahl(null);
      expect(geschrieben).toEqual([
        `${ORG_AUSWAHL_COOKIE}=abc-id; path=/; SameSite=Lax`,
        `${ORG_AUSWAHL_COOKIE}=; path=/; SameSite=Lax; Max-Age=0`,
      ]);
    } finally {
      Reflect.deleteProperty(document, "cookie");
    }
  });
});
