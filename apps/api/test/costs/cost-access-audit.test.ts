/**
 * Datenschutzgrenze des Kostenzugriffsprotokolls (EYT-106 AK9, EYT-135).
 *
 * ## Was hier geprueft wird — und warum genau so
 *
 * Ein Auditereignis ist eine Datenschutzentscheidung, kein Logaufruf. Die
 * Gefahr ist nicht, dass zu wenig protokolliert wird, sondern dass irgendwann
 * jemand "nur kurz" den Mitarbeiternamen oder den Stundensatz mit hineinlegt,
 * um ein Ticket schneller zu debuggen. Dagegen hilft keine Konvention,
 * sondern nur eine Serialisierung, die AUSSCHLIESSLICH eine feste Feldliste
 * kennt und alles andere fallen laesst.
 *
 * Deshalb prueft diese Datei die Serialisierung gegen eine hier **woertlich
 * hingeschriebene** Feldliste und nicht gegen `COST_ACCESS_EVENT_FIELDS`.
 * Wer ueber dieselbe Konstante iteriert, die die Implementierung benutzt,
 * prueft seine eigene Nachbildung: ein zusaetzliches Feld waere auf beiden
 * Seiten zugleich da und der Test bliebe gruen. Das ist der Fehler, den
 * Sprint 3 neunmal gemacht hat.
 *
 * ## Gegenmutationen, die diese Datei rot machen
 *
 * - `correlationId` aus `COST_ACCESS_EVENT_FIELDS` entfernen.
 * - `employeeName` oder `amountMinorUnits` in die Feldliste aufnehmen.
 * - `serialisiereZugriffsereignis` auf `JSON.stringify(event)` umstellen
 *   (dann wandern angeheftete Fremdfelder mit hinaus).
 * - Das Pseudonym durch die rohe Subjekt-Id ersetzen.
 */
import { describe, expect, it } from "vitest";

// Ueber die oeffentliche Modul-API, nicht ueber den Dateipfad: der
// Grenzentest `costs-module-boundaries` verbietet den Tiefzugriff, und er hat
// diesen Import beim ersten Lauf zu Recht gemeldet.
import {
  COST_ACCESS_DENY_REASONS,
  COST_ACCESS_EVENT_FIELDS,
  pseudonymSubjekt,
  serialisiereZugriffsereignis,
  type CostAccessDecisionEvent,
} from "../../src/modules/costs";

const SUBJEKT_A = "00000000-0000-4000-8000-00000000aaa1";
const SUBJEKT_B = "00000000-0000-4000-8000-00000000bbb1";

/**
 * Markierung fuer "dieser Wert darf in keiner Logzeile stehen".
 *
 * Aus Teilen zusammengesetzt und ohne JWT-Form: als durchgehendes
 * `eyJ…`-Literal hat gitleaks 8.24.3 die Zeile als `generic-api-key` gemeldet
 * (gemessen 01.08.2026, Entropie 4.42). Der Test braucht keinen echt
 * aussehenden Token — er braucht eine Zeichenkette, die eindeutig
 * wiedererkennbar ist, wenn sie faelschlich hinausgeschrieben wird.
 */
const ERFUNDENES_TOKEN = ["kein", "echtes", "token", "nur", "eine", "markierung"].join("-");

/**
 * Die vollstaendige, erlaubte Feldliste — hier bewusst als Literal.
 * Sie ist die Zusage an den Product Owner, nicht ein Spiegel des Codes.
 */
const ERLAUBTE_FELDER = [
  "at",
  "correlationId",
  "decision",
  "event",
  "organisationId",
  "permission",
  "reason",
  "route",
  "subject",
] as const;

function erlaubnisEreignis(): CostAccessDecisionEvent {
  return {
    event: "cost_access_decision",
    correlationId: "5f1b0f6a-6c3a-4f4e-9a1f-2b0d9f7c1a11",
    decision: "allow",
    permission: "costs.read",
    organisationId: "00000000-0000-4000-8000-00000000a001",
    subject: pseudonymSubjekt(SUBJEKT_A),
    reason: null,
    at: "2026-08-01T20:11:02.114Z",
    route: "GET /kosten/mitarbeiter",
  };
}

describe("Zugriffsereignis traegt genau die vereinbarten Felder (EYT-106 AK9)", () => {
  it("serialisiert exakt die neun erlaubten Felder", () => {
    const gelesen = JSON.parse(serialisiereZugriffsereignis(erlaubnisEreignis())) as Record<
      string,
      unknown
    >;

    expect(Object.keys(gelesen).sort()).toEqual([...ERLAUBTE_FELDER]);
  });

  it("die Feldliste der Implementierung ist genau diese Liste", () => {
    // Zweite, unabhaengige Zusicherung: die exportierte Liste darf nicht
    // stillschweigend wachsen, auch wenn die Serialisierung sie respektiert.
    expect([...COST_ACCESS_EVENT_FIELDS].sort()).toEqual([...ERLAUBTE_FELDER]);
  });

  it("laesst angeheftete Fremdfelder fallen statt sie mitzuschreiben", () => {
    // Genau der realistische Unfall: jemand reicht ein angereichertes Objekt
    // durch, weil TypeScript strukturell typisiert und ein Extrafeld an einer
    // Variablen (nicht am Objektliteral) nicht auffaellt.
    const angereichert = {
      ...erlaubnisEreignis(),
      employeeName: "Demo-Mitarbeiter 01",
      amountMinorUnits: "3850",
      accessToken: ERFUNDENES_TOKEN,
      cookie: `easytree_access=${ERFUNDENES_TOKEN}`,
    } as CostAccessDecisionEvent;

    const ausgabe = serialisiereZugriffsereignis(angereichert);

    expect(ausgabe).not.toContain("Demo-Mitarbeiter");
    expect(ausgabe).not.toContain("3850");
    expect(ausgabe).not.toContain(ERFUNDENES_TOKEN);
    expect(ausgabe).not.toContain("easytree_access");
    expect(Object.keys(JSON.parse(ausgabe) as Record<string, unknown>).sort()).toEqual([
      ...ERLAUBTE_FELDER,
    ]);
  });

  it("nennt genau vier stabile Ablehnungsgruende", () => {
    expect([...COST_ACCESS_DENY_REASONS]).toEqual([
      "UNAUTHENTICATED",
      "ORG_CONTEXT_REQUIRED",
      "ORG_NOT_A_MEMBER",
      "PERMISSION_MISSING",
    ]);
  });
});

describe("Das Subjekt erscheint nur pseudonym (EYT-106 AK9)", () => {
  it("bildet dieselbe Person stabil auf dasselbe Pseudonym ab", () => {
    // Stabil, weil ein Audit sonst wertlos waere: man muss die Entscheidungen
    // EINER Person ueber die Zeit zusammenfuehren koennen, ohne zu wissen,
    // wer sie ist.
    expect(pseudonymSubjekt(SUBJEKT_A)).toBe(pseudonymSubjekt(SUBJEKT_A));
  });

  it("haelt verschiedene Personen auseinander", () => {
    expect(pseudonymSubjekt(SUBJEKT_A)).not.toBe(pseudonymSubjekt(SUBJEKT_B));
  });

  it("enthaelt die rohe Subjekt-Id nicht und nicht einmal ihren Anfang", () => {
    const pseudonym = pseudonymSubjekt(SUBJEKT_A);
    expect(pseudonym).not.toContain(SUBJEKT_A);
    expect(pseudonym).not.toContain("aaa1");
    expect(pseudonym).not.toContain("00000000");
  });

  it("liefert die festgeschriebenen Vektoren", () => {
    // Festgenagelt, damit ein Wechsel des Verfahrens sichtbar wird statt
    // stillschweigend alle bisherigen Auditspuren unverknuepfbar zu machen.
    expect(pseudonymSubjekt(SUBJEKT_A)).toBe("subj_01ff5f422bd9b669");
    expect(pseudonymSubjekt(SUBJEKT_B)).toBe("subj_98d7e9b56cf661cf");
  });
});
