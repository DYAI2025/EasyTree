import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HISTORISCHES_EVIDENZ_VERZEICHNIS,
  KANONISCHE_STAGING_URL,
  KANONISCHER_SATZ_FEHLT_MITARBEITER,
  MAX_WOCHEN_ABSTAND,
  SATZ_FEHLT_PROBLEM_TYPE,
  autorisierungsVerdikt,
  datumInWoche,
  leseReiseEingaben,
  pruefeEvidenzVerzeichnis,
  pruefeStagingUrl,
  satzFehltFixtureVerdikt,
  satzFehltMitarbeiterBefund,
  satzFehltVerdikt,
  schreibeEvidenz,
  wochenAbstandNachVorn,
} from "../e2e/staging/harness-wachen";
import { parseIsoWeekKey } from "@easytree/contracts";

/**
 * Deterministische Pruefung der Staging-Harness-Wachen (EYT-142, Reparatur
 * 26.08.2026). Jede hier geprüfte Regel hat eine benannte Gegenmutation, die
 * sie rot macht — ausgefuehrt bei der Einfuehrung, dokumentiert im PR.
 */

// 2026-11-04 ist ein Mittwoch; in Europe/Berlin liegt er in der ISO-Woche
// 2026-W45 (Montag 02.11. bis Sonntag 08.11.).
const MITTWOCH_W45 = new Date("2026-11-04T12:00:00Z");

function woche(schluessel: string) {
  const ergebnis = parseIsoWeekKey(schluessel);
  if (!ergebnis.ok) throw new Error(`Testfixture ungueltig: ${schluessel}`);
  return ergebnis.week;
}

const GUELTIGE_EINGABEN = {
  EYT_JOURNEY_WOCHE: "2026-W46",
  EYT_SATZ_FEHLT_WOCHE: "2026-W47",
  EYT_SATZ_FEHLT_MITARBEITER: "E2E-Mitarbeiter Ohne Satz",
};

describe("pruefeStagingUrl — HTTPS-Pflicht ohne stillen Rueckfall", () => {
  it("liefert ohne Angabe die kanonische HTTPS-Origin", () => {
    expect(pruefeStagingUrl(undefined)).toBe("https://srv1308064.hstgr.cloud");
    expect(pruefeStagingUrl("")).toBe(KANONISCHE_STAGING_URL);
    expect(new URL(KANONISCHE_STAGING_URL).protocol).toBe("https:");
  });

  it("akzeptiert eine ausdrueckliche HTTPS-Adresse unveraendert", () => {
    expect(pruefeStagingUrl("https://staging.example.org")).toBe("https://staging.example.org");
  });

  it("lehnt das alte plain-HTTP-Ziel sofort ab, statt spaeter zu haengen", () => {
    expect(() => pruefeStagingUrl("http://srv1308064.hstgr.cloud:3009")).toThrow(/nicht HTTPS/);
  });

  it("lehnt auch http auf localhost ab — die reale Staging-Reise kennt keinen Sonderweg", () => {
    expect(() => pruefeStagingUrl("http://localhost:3000")).toThrow(/nicht HTTPS/);
  });

  it("lehnt eine relative oder unparsbare Angabe ab", () => {
    expect(() => pruefeStagingUrl("srv1308064.hstgr.cloud")).toThrow(/keine absolute URL/);
  });

  it("lehnt Zugangsdaten in der Adresse ab", () => {
    expect(() => pruefeStagingUrl("https://a:b@staging.example.org")).toThrow(/Zugangsdaten/);
  });
});

describe("leseReiseEingaben — laufende Woche aus der Uhr, Schreibwochen als Pflicht-Eingabe", () => {
  it("leitet die laufende Woche aus dem Zeitpunkt ab, nicht aus einer festen Woche", () => {
    const eingaben = leseReiseEingaben(GUELTIGE_EINGABEN, MITTWOCH_W45);
    expect(eingaben.laufendeWocheKey).toBe("2026-W45");
    expect(eingaben.vorherigeWocheKey).toBe("2026-W44");
    expect(eingaben.naechsteWocheKey).toBe("2026-W46");
    // Ein anderer Zeitpunkt ergibt eine andere Woche — nichts ist verdrahtet.
    const spaeter = leseReiseEingaben(
      { ...GUELTIGE_EINGABEN, EYT_JOURNEY_WOCHE: "2026-W48", EYT_SATZ_FEHLT_WOCHE: "2026-W49" },
      new Date("2026-11-18T12:00:00Z"),
    );
    expect(spaeter.laufendeWocheKey).toBe("2026-W47");
  });

  it("benutzt die Zeitzonensemantik der Anwendung (Europe/Berlin), nicht UTC", () => {
    // Sonntag 23:30 UTC ist in Berlin (CET) bereits Montag 00:30 der Folgewoche.
    const eingaben = leseReiseEingaben(
      { ...GUELTIGE_EINGABEN, EYT_JOURNEY_WOCHE: "2026-W47", EYT_SATZ_FEHLT_WOCHE: "2026-W48" },
      new Date("2026-11-08T23:30:00Z"),
    );
    expect(eingaben.laufendeWocheKey).toBe("2026-W46");
  });

  it("traegt keinen Vorgabewert fuer die Schreibwoche — fehlende Eingabe bricht praezise ab", () => {
    expect(() => leseReiseEingaben({}, MITTWOCH_W45)).toThrow(/EYT_JOURNEY_WOCHE fehlt/);
    expect(() => leseReiseEingaben({ EYT_JOURNEY_WOCHE: "2026-W46" }, MITTWOCH_W45)).toThrow(
      /EYT_SATZ_FEHLT_WOCHE fehlt/,
    );
  });

  it("faellt ohne EYT_SATZ_FEHLT_MITARBEITER auf die kanonische Fixture-Identitaet zurueck", () => {
    // Reparatur 26.08.2026: der Mitarbeiter ist Fixture-Wahrheit (fixtures.sql,
    // Employee …e212), kein manuell erinnerter Umgebungszustand. Ob er wirklich
    // existiert und satzlos ist, misst der Pre-flight der Reise — hier steht
    // nur, dass die Identitaet aus dem Repository kommt.
    const ohne = leseReiseEingaben(
      { EYT_JOURNEY_WOCHE: "2026-W46", EYT_SATZ_FEHLT_WOCHE: "2026-W47" },
      MITTWOCH_W45,
    );
    expect(ohne.satzFehltMitarbeiter).toBe(KANONISCHER_SATZ_FEHLT_MITARBEITER);
    expect(KANONISCHER_SATZ_FEHLT_MITARBEITER).toBe("E2E-Mitarbeiter Ohne Satz");
    // Leerstring zaehlt als "nicht gesetzt", nicht als Name.
    const leer = leseReiseEingaben(
      {
        EYT_JOURNEY_WOCHE: "2026-W46",
        EYT_SATZ_FEHLT_WOCHE: "2026-W47",
        EYT_SATZ_FEHLT_MITARBEITER: "",
      },
      MITTWOCH_W45,
    );
    expect(leer.satzFehltMitarbeiter).toBe(KANONISCHER_SATZ_FEHLT_MITARBEITER);
    // Die bewusste Uebersteuerung bleibt moeglich (Altbestand eines Stacks).
    const uebersteuert = leseReiseEingaben(
      { ...GUELTIGE_EINGABEN, EYT_SATZ_FEHLT_MITARBEITER: "Altbestand Ohne Satz" },
      MITTWOCH_W45,
    );
    expect(uebersteuert.satzFehltMitarbeiter).toBe("Altbestand Ohne Satz");
  });

  it("lehnt eine unparsbare Wochenangabe ab", () => {
    expect(() =>
      leseReiseEingaben({ ...GUELTIGE_EINGABEN, EYT_JOURNEY_WOCHE: "W46" }, MITTWOCH_W45),
    ).toThrow(/kein gueltiger ISO-Wochenschluessel/);
  });

  it("lehnt eine vergangene oder die laufende Woche als Schreibwoche ab", () => {
    expect(() =>
      leseReiseEingaben({ ...GUELTIGE_EINGABEN, EYT_JOURNEY_WOCHE: "2026-W45" }, MITTWOCH_W45),
    ).toThrow(/NACH der laufenden Woche/);
    expect(() =>
      leseReiseEingaben({ ...GUELTIGE_EINGABEN, EYT_SATZ_FEHLT_WOCHE: "2026-W44" }, MITTWOCH_W45),
    ).toThrow(/NACH der laufenden Woche/);
  });

  it("lehnt dieselbe Woche fuer Reise und Satz-fehlt ab (ein Entwurf je Woche und Org)", () => {
    expect(() =>
      leseReiseEingaben({ ...GUELTIGE_EINGABEN, EYT_SATZ_FEHLT_WOCHE: "2026-W46" }, MITTWOCH_W45),
    ).toThrow(/dieselbe Woche/);
  });

  it("haelt Woche und Datum zusammen: abgeleiteter Montag, geprüfte ausdrueckliche Angabe", () => {
    const eingaben = leseReiseEingaben(GUELTIGE_EINGABEN, MITTWOCH_W45);
    expect(eingaben.reisewocheKey).toBe("2026-W46");
    expect(eingaben.reiseOffset).toBe(1);
    expect(eingaben.reiseKlickWochen).toEqual(["2026-W46"]);
    expect(eingaben.einsatzDatum).toBe("2026-11-09"); // Montag der 2026-W46
    expect(eingaben.satzFehltWocheKey).toBe("2026-W47");
    expect(eingaben.satzFehltDatum).toBe("2026-11-16"); // Montag der 2026-W47

    const mitDatum = leseReiseEingaben(
      { ...GUELTIGE_EINGABEN, EYT_JOURNEY_DATUM: "2026-11-11" },
      MITTWOCH_W45,
    );
    expect(mitDatum.einsatzDatum).toBe("2026-11-11");

    expect(() =>
      leseReiseEingaben({ ...GUELTIGE_EINGABEN, EYT_JOURNEY_DATUM: "2026-11-16" }, MITTWOCH_W45),
    ).toThrow(/liegt nicht in der Woche 2026-W46/);
    expect(() =>
      leseReiseEingaben({ ...GUELTIGE_EINGABEN, EYT_JOURNEY_DATUM: "11.11.2026" }, MITTWOCH_W45),
    ).toThrow(/JJJJ-MM-TT/);
  });

  it("uebersteht die Jahresgrenze: 2026 hat 53 ISO-Wochen", () => {
    const eingaben = leseReiseEingaben(
      {
        EYT_JOURNEY_WOCHE: "2027-W01",
        EYT_SATZ_FEHLT_WOCHE: "2027-W02",
        EYT_SATZ_FEHLT_MITARBEITER: "E2E-Mitarbeiter Ohne Satz",
      },
      new Date("2026-12-30T12:00:00Z"),
    );
    expect(eingaben.laufendeWocheKey).toBe("2026-W53");
    expect(eingaben.naechsteWocheKey).toBe("2027-W01");
    expect(eingaben.reiseOffset).toBe(1);
    expect(eingaben.einsatzDatum).toBe("2027-01-04"); // Montag der 2027-W01
  });
});

describe("wochenAbstandNachVorn — Klickweg mit Schranke", () => {
  it("zaehlt Vorwaertsschritte und meldet Unerreichbares als -1", () => {
    const w45 = woche("2026-W45");
    expect(wochenAbstandNachVorn(w45, woche("2026-W46"))).toBe(1);
    expect(wochenAbstandNachVorn(w45, woche("2026-W45"))).toBe(0);
    expect(wochenAbstandNachVorn(w45, woche("2026-W44"))).toBe(-1);
    // 2026 hat 53 Wochen: 12 Schritte ab W45 landen in 2027-W04.
    expect(wochenAbstandNachVorn(w45, woche("2027-W04"))).toBe(MAX_WOCHEN_ABSTAND);
    expect(wochenAbstandNachVorn(w45, woche("2027-W05"))).toBe(-1);
  });
});

describe("datumInWoche — Widerspruchsfreiheit von Woche und Tag", () => {
  it("leitet ohne Angabe den Montag der Woche ab", () => {
    expect(datumInWoche(woche("2026-W46"), undefined, "X")).toBe("2026-11-09");
    expect(datumInWoche(woche("2026-W46"), "", "X")).toBe("2026-11-09");
  });

  it("akzeptiert den Sonntag als letzten Tag der Woche", () => {
    expect(datumInWoche(woche("2026-W46"), "2026-11-15", "X")).toBe("2026-11-15");
  });

  it("lehnt einen Tag ausserhalb der Woche ab", () => {
    expect(() => datumInWoche(woche("2026-W46"), "2026-11-08", "X")).toThrow(/liegt nicht/);
  });
});

describe("autorisierungsVerdikt — exakt 403, ein 5xx ist kein Sicherheitsnachweis", () => {
  it("haelt bei exakt 403", () => {
    expect(autorisierungsVerdikt(403)).toBeNull();
  });

  it("lehnt 500 ab — die alte >=403-Zusicherung liess das durch", () => {
    expect(autorisierungsVerdikt(500)).toMatch(/HTTP 500 statt exakt 403/);
  });

  it("lehnt jede andere Antwort ab, auch 200 und 401", () => {
    expect(autorisierungsVerdikt(200)).toMatch(/statt exakt 403/);
    expect(autorisierungsVerdikt(401)).toMatch(/statt exakt 403/);
    expect(autorisierungsVerdikt(404)).toMatch(/statt exakt 403/);
  });
});

describe("satzFehltVerdikt — exakt 409 mit dem gemessenen Problem-URN", () => {
  it("haelt bei 409 und rate-not-found", () => {
    expect(satzFehltVerdikt(409, SATZ_FEHLT_PROBLEM_TYPE)).toBeNull();
  });

  it("lehnt 500 ab — die alte >=400-Zusicherung liess das durch", () => {
    expect(satzFehltVerdikt(500, SATZ_FEHLT_PROBLEM_TYPE)).toMatch(/HTTP 500 statt exakt 409/);
  });

  it("lehnt 409 mit fremdem oder fehlendem problem.type ab", () => {
    expect(satzFehltVerdikt(409, "urn:easytree:planning:conflict")).toMatch(
      /statt "urn:easytree:costs:rate-not-found"/,
    );
    expect(satzFehltVerdikt(409, undefined)).toMatch(/undefined/);
  });
});

describe("satzFehltMitarbeiterBefund — Fixture-Existenz VOR dem ersten Publish", () => {
  const OHNE_SATZ = {
    id: "00000000-0000-4000-8000-00000000e212",
    displayName: KANONISCHER_SATZ_FEHLT_MITARBEITER,
    active: true,
  };
  const MIT_SATZ = {
    id: "00000000-0000-4000-8000-00000000e211",
    displayName: "E2E-Mitarbeiter Reise",
    active: true,
  };

  it("findet den kanonischen Mitarbeiter und liefert seine Server-Id", () => {
    const befund = satzFehltMitarbeiterBefund(
      [MIT_SATZ, OHNE_SATZ],
      KANONISCHER_SATZ_FEHLT_MITARBEITER,
    );
    expect(befund).toEqual({ ok: true, id: OHNE_SATZ.id });
  });

  it("meldet eine FEHLENDE Fixture mit Verweis auf fixtures.sql — vor jeder verbrauchten Woche", () => {
    const befund = satzFehltMitarbeiterBefund([MIT_SATZ], KANONISCHER_SATZ_FEHLT_MITARBEITER);
    expect(befund.ok).toBe(false);
    if (befund.ok) return;
    expect(befund.grund).toMatch(/fixtures\.sql/);
    expect(befund.grund).toMatch(/keine Woche wurde verbraucht/);
  });

  it("lehnt einen inaktiven Mitarbeiter ab — das Formular boete ihn nicht an", () => {
    const befund = satzFehltMitarbeiterBefund(
      [{ ...OHNE_SATZ, active: false }],
      KANONISCHER_SATZ_FEHLT_MITARBEITER,
    );
    expect(befund.ok).toBe(false);
    if (befund.ok) return;
    expect(befund.grund).toMatch(/inaktiv/);
  });

  it("lehnt einen mehrfach vergebenen Anzeigenamen ab — die Label-Auswahl waere mehrdeutig", () => {
    const befund = satzFehltMitarbeiterBefund(
      [OHNE_SATZ, { ...OHNE_SATZ, id: "00000000-0000-4000-8000-00000000e219" }],
      KANONISCHER_SATZ_FEHLT_MITARBEITER,
    );
    expect(befund.ok).toBe(false);
    if (befund.ok) return;
    expect(befund.grund).toMatch(/mehrdeutig/);
  });
});

describe("satzFehltFixtureVerdikt — die definierende Eigenschaft: exakt NULL Satzversionen", () => {
  it("haelt bei exakt null Versionen", () => {
    expect(satzFehltFixtureVerdikt(0)).toBeNull();
  });

  it("lehnt jede vorhandene Satzversion ab — der Snapshot wuerde erzeugt statt abgelehnt", () => {
    expect(satzFehltFixtureVerdikt(1)).toMatch(/statt exakt 0/);
    expect(satzFehltFixtureVerdikt(1)).toMatch(/vor dem Publish/);
    expect(satzFehltFixtureVerdikt(3)).toMatch(/^3 Satzversion/);
  });
});

describe("schreibeEvidenz — ein halber Lauf ersetzt ids.json nicht", () => {
  it("laesst bei einem fehlgeschlagenen Lauf das kanonische ids.json byte-unveraendert", () => {
    const verzeichnis = mkdtempSync(join(tmpdir(), "eyt142-evidenz-"));
    const kanonisch = join(verzeichnis, "ids.json");
    writeFileSync(kanonisch, '{"letzter":"guter Lauf"}');

    const ergebnis = schreibeEvidenz(verzeichnis, { neu: "partial" }, false, "STEMPEL");

    expect(readFileSync(kanonisch, "utf8")).toBe('{"letzter":"guter Lauf"}');
    expect(ergebnis.kanonisch).toBe(false);
    expect(ergebnis.datei).toBe(join(verzeichnis, "ids.partial-STEMPEL.json"));
    expect(JSON.parse(readFileSync(ergebnis.datei, "utf8"))).toEqual({ neu: "partial" });
  });

  it("schreibt ids.json nur nach einem vollstaendigen gruenen Lauf", () => {
    const verzeichnis = mkdtempSync(join(tmpdir(), "eyt142-evidenz-"));
    const ergebnis = schreibeEvidenz(verzeichnis, { lauf: "gruen" }, true, "STEMPEL");
    expect(ergebnis.kanonisch).toBe(true);
    expect(ergebnis.datei).toBe(join(verzeichnis, "ids.json"));
    expect(JSON.parse(readFileSync(join(verzeichnis, "ids.json"), "utf8"))).toEqual({
      lauf: "gruen",
    });
    expect(existsSync(join(verzeichnis, "ids.partial-STEMPEL.json"))).toBe(false);
  });
});

describe("pruefeEvidenzVerzeichnis — das historische Paket ist kein Ziel", () => {
  it("liefert ohne Angabe das Wegwerf-Verzeichnis", () => {
    expect(pruefeEvidenzVerzeichnis(undefined)).toBe("/tmp/eyt-142-evidence");
  });

  it("lehnt das abgeschlossene Evidenzverzeichnis vom 25.08.2026 ab", () => {
    expect(() =>
      pruefeEvidenzVerzeichnis(`/irgendein/klon/${HISTORISCHES_EVIDENZ_VERZEICHNIS}`),
    ).toThrow(/byte-unveraendert/);
    expect(() => pruefeEvidenzVerzeichnis(`/klon/${HISTORISCHES_EVIDENZ_VERZEICHNIS}/`)).toThrow(
      /byte-unveraendert/,
    );
  });
});

describe("Quelltext-Wache — keine verbrauchbaren Wochen, kein HTTP, keine >=-Statusvertraege", () => {
  // Testlauf-cwd ist das Paketverzeichnis apps/web (wie in
  // no-supabase-import.test.ts).
  const journeyQuelle = readFileSync(join(process.cwd(), "e2e/staging/journey.pwtest.ts"), "utf8");
  const configQuelle = readFileSync(join(process.cwd(), "e2e/staging/staging.config.ts"), "utf8");

  it("die Reise traegt keinen fest verdrahteten Wochenschluessel und kein festes Datum mehr", () => {
    // 2026-W35/W37/W38 waren verbraucht; JEDER eingebettete Schluessel waere
    // beim naechsten Lauf eine tickende Wiederholung desselben Fehlers.
    expect(journeyQuelle).not.toMatch(/\d{4}-W\d{2}/);
    expect(journeyQuelle).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("die Reise vergleicht Ablehnungen nicht mehr per >=", () => {
    expect(journeyQuelle).not.toMatch(/toBeGreaterThanOrEqual\(\s*4\d{2}/);
  });

  it("die Konfiguration kennt kein plain-HTTP-Ziel mehr und prueft ueber die Wache", () => {
    expect(configQuelle).not.toContain("http://");
    expect(configQuelle).toContain("pruefeStagingUrl");
  });

  it("der Pre-flight steht VOR der ersten Schreibstation — in der seriellen Suite bricht er also vor jedem Publish", () => {
    // Die Suite laeuft `describe.serial`: scheitert der Pre-flight, werden
    // alle folgenden Tests uebersprungen. Damit das "vor jeder verbrauchten
    // Woche" ist und bleibt, muss er im Quelltext vor Station 4 (erster
    // Schreibversuch) und vor Station 6 (erster Publish) stehen.
    const preflight = journeyQuelle.indexOf('test("Pre-flight');
    const ersteSchreibstation = journeyQuelle.indexOf('test("Station 4');
    expect(preflight).toBeGreaterThan(-1);
    expect(ersteSchreibstation).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(ersteSchreibstation);
    expect(journeyQuelle).toContain("describe.serial");
    expect(journeyQuelle).toContain("satzFehltMitarbeiterBefund");
    expect(journeyQuelle).toContain("satzFehltFixtureVerdikt");
  });
});
