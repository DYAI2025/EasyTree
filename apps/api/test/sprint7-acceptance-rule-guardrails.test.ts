/**
 * Wächter für den Sprint-7-UI/UX-Abnahmevertrag (EYT-148, Sprint 579).
 *
 * Läuft im Pflichtjob `unit-tests` (`pnpm test` -> `turbo run test`) — bewusst
 * kein eigener CI-Job, damit das Ruleset nicht neu angewendet werden muss
 * (Muster EYT-46/EYT-89).
 *
 * Anlass: Der Sprint-7-Abnahmevertrag (reale Journeys statt Mocks, Human-only-
 * PO-Gate, Golden-Baseline-Schutz) lebte bisher nur in Chat-Kontext einzelner
 * Claude-Sessions. Diese Suite bindet ihn an das Repository: sie wird rot, wenn
 * die Rule-Datei fehlt, CLAUDE.md sie nicht mehr referenziert oder einer der
 * semantisch tragenden Marker entfernt wird.
 *
 * Geprüft werden Struktur und Marker, NICHT der Wortlaut ganzer Absätze:
 * redaktionelle Verbesserungen bleiben möglich, das Verschwinden einer
 * Schutzregel nicht. Wie in `handoff-guardrails.test.ts` steht vor den
 * Inhaltszusicherungen eine Nicht-Leerlauf-Zusicherung.
 *
 * Bewusste Grenzen und Eigenheiten:
 * - Eine semantische Umkehrung eines Markers (der wörtlich zitierte Marker
 *   in einem verneinenden Satz) bleibt BY DESIGN unerkannt: Diese Suite
 *   prüft Struktur und Marker, nicht Bedeutung — dieselbe Philosophie wie
 *   `handoff-guardrails.test.ts`.
 * - Die drei langen Marker-Sätze stehen in der Rule ABSICHTLICH einzeilig
 *   (Byte-Identität mit den hier konkatenierten Markern). Ein künftiges
 *   `proseWrap`-Setting in `.prettierrc.json` würde sie hart umbrechen und
 *   diese Suite rot machen — dieses Rot bedeutet Formatierung, nicht
 *   Inhaltsverlust.
 * - HTML-Kommentare und eingezäunte Codeblöcke werden vor Struktur- und
 *   Markersuche entfernt: ein Marker, der nur dort steht, hält den Guard
 *   nicht grün; allein die globale Längenuntergrenze liest den Rohtext.
 *
 * Lebenszyklus: Diese Suite darf erst entfernt werden, wenn die Removal
 * Condition der Rule erfüllt ist (Sprint 7 formal PO-abgenommen und in Jira
 * geschlossen); siehe `.claude/rules/sprint-7-ui-ux-acceptance.md`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findRepoRoot } from "./architecture/scan";

const repoRoot = findRepoRoot(process.cwd());
const RULE_PATH = ".claude/rules/sprint-7-ui-ux-acceptance.md";
const ruleAbs = join(repoRoot, RULE_PATH);

/** Semantisch tragende Marker. Jeder steht für eine eigene Schutzregel. */
const MARKER_SPRINT = "Sprint ID 579";
const MARKER_GATE_ISSUE = "EYT-148";
const MARKER_FINAL_STATE = "READY_FOR_PO_VISUAL_REVIEW";
const MARKER_HUMAN_GATE =
  "Ein Coding Agent kann keine PO-/UI-/UX-Abnahme erzeugen; " +
  "die visuelle und UX-seitige Sprintfreigabe ist Human-/PO-only.";
const MARKER_BASELINE_BAN =
  "Eine neue oder geänderte Golden Baseline benötigt explizite menschliche " +
  "PO-Freigabe; ein automatisches Baseline-Update (etwa via --update-snapshots) " +
  "ist verboten.";
const MARKER_REAL_STACK =
  "Browser → Next/Web → reale API → reale Authentifizierung → PostgreSQL/RLS";
const MARKER_REMOVAL =
  "Diese Regel darf erst entfernt oder archiviert werden, nachdem Sprint 7 in " +
  "Jira formal PO-abgenommen und geschlossen ist und alle wiederverwendbaren " +
  "Anforderungen in dauerhafte Frontend-Qualitätsregeln überführt wurden.";

/** Pflichtabschnitte — das Fehlen eines Abschnitts hebt eine Zusicherung auf. */
const REQUIRED_SECTIONS = [
  "Status und Lebenszyklus",
  "Quellen-Autorität (SSoT)",
  "Product Truth",
  "Bestehende Testarchitektur",
  "Test-per-Increment",
  "Viewports",
  "Accessibility",
  "Zustände (States)",
  "Visual Regression",
  "Browser Integrity",
  "Autorisierung",
  "EYT-148 Final Journey Gate",
  "PO Acceptance Evidence",
  "Human Gate",
] as const;

function readRule(): string {
  if (!existsSync(ruleAbs)) {
    throw new Error(
      `${RULE_PATH} fehlt. Der Sprint-7-Abnahmevertrag (EYT-148) ist damit ` +
        "unverankert; CLAUDE.md verweist ins Leere. Datei wiederherstellen — " +
        "entfernen ist erst nach erfüllter Removal Condition zulässig.",
    );
  }
  return readFileSync(ruleAbs, "utf8");
}

function headings(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
}

/**
 * Entfernt HTML-Kommentare und eingezäunte Codeblöcke. Was nur dort steht,
 * ist für Leser der Regel unsichtbar bzw. Zitat — es darf weder Marker- noch
 * Strukturzusicherungen grün halten (Reviewbefund: eine hohle Datei mit allen
 * Markern in einem Kommentar bestand die erste Fassung dieser Suite).
 */
function stripNonSemantic(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```/g, "");
}

/** Abschnittskörper: Text nach einer `## `-Überschrift bis zur nächsten. */
function sectionBodies(markdown: string): Map<string, string> {
  const bodies = new Map<string, string>();
  let current: string | undefined;
  let buffer: string[] = [];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      if (current !== undefined) {
        bodies.set(current, buffer.join("\n"));
      }
      current = line.slice(3).trim();
      buffer = [];
    } else if (current !== undefined) {
      buffer.push(line);
    }
  }
  if (current !== undefined) {
    bodies.set(current, buffer.join("\n"));
  }
  return bodies;
}

/**
 * Untergrenze an Nicht-Whitespace-Zeichen je Pflichtabschnitt: grob die
 * Hälfte des kleinsten realen Abschnitts (gemessen 29.08.2026: 251 Zeichen,
 * „Zustände (States)"), auf einen runden Wert gesetzt. Redaktionelles Kürzen
 * bleibt möglich; das Entkernen eines Abschnitts auf eine leere Hülle wird rot.
 */
const SECTION_MIN_NON_WS = 150;

describe("Sprint-7-UI/UX-Abnahmevertrag (EYT-148)", () => {
  const rawRule = readRule();
  const rule = stripNonSemantic(rawRule);
  const found = headings(rule);
  const bodies = sectionBodies(rule);

  it("hat ueberhaupt Struktur (Nicht-Leerlauf-Zusicherung)", () => {
    expect(rawRule.length).toBeGreaterThan(4000);
    expect(found.length).toBeGreaterThanOrEqual(REQUIRED_SECTIONS.length);
  });

  it.each(REQUIRED_SECTIONS)("enthaelt den Pflichtabschnitt '%s'", (section) => {
    expect(found).toContain(section);
  });

  it.each(REQUIRED_SECTIONS)(
    "Pflichtabschnitt '%s' ist nicht entkernt (Substanz-Untergrenze)",
    (section) => {
      const body = bodies.get(section) ?? "";
      expect(body.replace(/\s+/g, "").length).toBeGreaterThanOrEqual(SECTION_MIN_NON_WS);
    },
  );

  it("bindet die Regel an Sprint 579 und EYT-148 als finales Abnahme-Gate", () => {
    expect(rule).toContain(MARKER_SPRINT);
    expect(rule).toContain(MARKER_GATE_ISSUE);
    expect(found).toContain("EYT-148 Final Journey Gate");
  });

  it("traegt die Removal Condition (kontrollierte, nicht stille Entfernung)", () => {
    expect(rule).toContain(MARKER_REMOVAL);
  });

  it("haelt den hoechsten Agenten-Endstatus vor menschlicher Abnahme fest", () => {
    expect(rule).toContain(MARKER_FINAL_STATE);
  });

  it("haelt das Human-/PO-only-Abnahme-Gate fest", () => {
    expect(rule).toContain(MARKER_HUMAN_GATE);
  });

  it("verbietet automatische Golden-Baseline-Aktualisierung", () => {
    expect(rule).toContain(MARKER_BASELINE_BAN);
  });

  it("verankert den realen Auth->API->PostgreSQL/RLS-Abnahmegrundsatz", () => {
    expect(rule).toContain(MARKER_REAL_STACK);
  });

  it("wird von CLAUDE.md als bindend referenziert", () => {
    const claudeMd = readFileSync(join(repoRoot, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain(RULE_PATH);
    // Schützt die Bindungsaussage des Ankers vor semantischer Abstufung;
    // die @-Import-Zeile selbst bleibt wie im Plan dokumentiert entfernbar.
    expect(claudeMd).toContain("is binding for all Sprint-7");
  });
});
