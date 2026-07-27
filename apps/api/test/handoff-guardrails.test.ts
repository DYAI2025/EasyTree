/**
 * Wächter für den Coding-Agent-Handoff (EYT-89).
 *
 * Läuft im Pflichtjob `unit-tests` (`pnpm test` -> `turbo run test`) — kein
 * eigener CI-Job.
 *
 * Anlass: PR #10 ersetzte `docs/handoff/AGENT_HANDOFF_v1.3.md` durch das
 * Root-Generator-Artefakt und entfernte dabei stillschweigend vier Abschnitte —
 * `Required working method`, `Prohibited actions`, die allgemeinen
 * `Stop conditions` und `Human review checkpoints`. Gleichzeitig verwies
 * `CLAUDE.md` weiter auf genau diese Datei als Quelle der Agent-Grenzen. Der
 * Verlust lag zwei Tage auf `master`, weil nichts ihn geprüft hat.
 *
 * Der Test prüft Struktur und Autoritätsaussage, NICHT den Wortlaut der Regeln:
 * Formulierungen sollen sich verbessern dürfen, das Fehlen eines ganzen
 * Abschnitts nicht unbemerkt bleiben.
 *
 * Wie `architecture.test.ts` gilt: eine Regel, die null Dateien sieht, meldet
 * null Verstösse. Deshalb steht vor jeder inhaltlichen Zusicherung eine
 * Nicht-Leerlauf-Zusicherung — ein leeres oder verschobenes Dokument macht
 * diese Suite rot, statt sie vakuös grün werden zu lassen.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findRepoRoot } from "./architecture/scan";

const repoRoot = findRepoRoot(process.cwd());
const HANDOFF_PATH = "docs/handoff/AGENT_HANDOFF_v1.3.md";
const handoffAbs = join(repoRoot, HANDOFF_PATH);

/**
 * Pflichtabschnitte. Jeder steht hier, weil sein Fehlen eine Zusicherung
 * aufhebt, die anderswo im Repo als vorhanden vorausgesetzt wird.
 */
const REQUIRED_SECTIONS = [
  "Authority",
  "Active scope",
  "Post-MVP economics boundary",
  "Required working method",
  "Prohibited actions",
  "Evidence rules",
  "Stop conditions",
  "Human review checkpoints",
  "Validation",
] as const;

/** Produktautorität — kanonisch, und nicht die Root-Generator-Artefakte. */
const CANONICAL_PRD = "docs/prd/CURRENT_PRD_v1.3.md";

function readHandoff(): string {
  if (!existsSync(handoffAbs)) {
    throw new Error(
      `${HANDOFF_PATH} fehlt. Der Handoff ist die Quelle der Agent-Grenzen; ` +
        "ohne ihn verweist CLAUDE.md ins Leere.",
    );
  }
  return readFileSync(handoffAbs, "utf8");
}

function headings(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
}

describe("Coding-Agent-Handoff (EYT-89)", () => {
  const handoff = readHandoff();
  const found = headings(handoff);

  it("hat ueberhaupt Struktur (Nicht-Leerlauf-Zusicherung)", () => {
    // Ohne diese Zusicherung wuerde ein leergeraeumtes Dokument die
    // Abschnittspruefung unten nicht etwa rot machen, sondern sie waere
    // schlicht gegenstandslos.
    expect(handoff.length).toBeGreaterThan(1000);
    expect(found.length).toBeGreaterThanOrEqual(REQUIRED_SECTIONS.length);
  });

  it.each(REQUIRED_SECTIONS)("enthaelt den Pflichtabschnitt '%s'", (section) => {
    expect(found).toContain(section);
  });

  it("nennt das kuratierte PRD als Produktautoritaet", () => {
    expect(handoff).toContain(CANONICAL_PRD);
  });

  it("stellt die Root-Artefakte NICHT als konkurrierende Produktautoritaet dar", () => {
    // Die Generator-Artefakte duerfen erwaehnt werden — aber als Evidenz.
    // Die frueher hier stehende Zeile "**Source of truth:** prd_report_v1.3.md"
    // machte sie zur konkurrierenden Autoritaet; genau das faellt hier auf.
    const sourceOfTruthLines = handoff
      .split("\n")
      .filter((line) => /source of truth/i.test(line))
      .filter((line) => /prd_report_v1\.3/.test(line));
    expect(sourceOfTruthLines).toEqual([]);
  });

  it("bindet die Post-MVP-Grenze weiterhin an konkrete Anforderungs-IDs", () => {
    // Die Praezision aus PR #10 ist ein Gewinn und darf beim Wiederherstellen
    // der Guardrails nicht zurueckfallen auf "das Wirtschaftsmodul".
    for (const id of ["FR-062", "FR-070", "DATA-023", "API-019", "PHASE-007", "TASK-032"]) {
      expect(handoff).toContain(id);
    }
  });

  it("wird von CLAUDE.md woertlich zutreffend beschrieben", () => {
    const claudeMd = readFileSync(join(repoRoot, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain(HANDOFF_PATH);
    // CLAUDE.md verweist auf den Handoff als Quelle der Agent-Grenzen. Das
    // stimmt nur, solange die Verbotsliste dort auch steht.
    expect(found).toContain("Prohibited actions");
  });
});
