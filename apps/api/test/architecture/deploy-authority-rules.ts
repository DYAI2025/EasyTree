/**
 * Regeln gegen eine ZWEITE Migrationsautoritaet (EYT-142).
 *
 * Eigentuemerin des Migrationspfads ist die Supabase-GitHub-Integration: ein
 * Merge nach `master` spielt die Migrationen ein. Wuerde ein Cloudflare-Build
 * zusaetzlich `supabase db push` (oder ein anderes Schemawerkzeug) ausfuehren,
 * gaebe es zwei Stellen, die dasselbe Schema veraendern duerfen — mit
 * unterschiedlicher Reihenfolge, unterschiedlichen Rechten und ohne gemeinsamen
 * Stand. `CLAUDE.md` nennt SQL-Migrationen die EINZIGE Schemaquelle; das hier
 * ist der Waechter dazu.
 *
 * Fail-closed an zwei Stellen: findet die Regel keine `wrangler.jsonc`, ist sie
 * ROT. Und laesst sich eine gefundene Datei nicht parsen, ist sie ebenfalls ROT
 * — ein Waechter, der eine unlesbare Konfiguration als "keine Funde"
 * durchwinkt, ist keiner.
 *
 * ## Warum `jsonc-parser` und keine eigene Vorverarbeitung
 *
 * `wrangler.jsonc` ist JSONC: Kommentare und nachlaufende Kommata sind erlaubt,
 * `JSON.parse` verweigert beides — und Prettier SETZT die Kommata. Die erste
 * Fassung dieses Waechters brachte dafuer zwei handgeschriebene,
 * zeichenkettenbewusste Vorverarbeitungsschritte mit. Die waren korrekt, aber
 * sie sind eine eigene Parserimplementierung mit eigener Fehlerflaeche
 * (Escapes, verschachtelte Blockkommentare, `//` innerhalb von Werten), die
 * niemand pflegen will. `jsonc-parser` ist der Parser, den VS Code selbst fuer
 * genau dieses Format benutzt.
 */
import { readFileSync } from "node:fs";

import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";

/** Werkzeuge, die Schema veraendern. Keines gehoert in einen Deploybefehl. */
export const SCHEMA_WERKZEUGE: readonly string[] = [
  "supabase db push",
  "supabase migration",
  "prisma migrate",
  "psql",
  "drizzle-kit push",
];

export interface DeployAuthorityFund {
  readonly datei: string;
  readonly feld: string;
  readonly werkzeug: string;
  readonly wert: string;
}

/**
 * Liest eine JSONC-Datei streng.
 *
 * `jsonc-parser` ist von Haus aus tolerant und liefert auch bei Syntaxfehlern
 * ein Teilergebnis. Fuer einen Sicherheitswaechter ist das die falsche
 * Voreinstellung: eine halb gelesene Konfiguration sieht aus wie eine saubere
 * ohne Befunde. Deshalb werden die Fehler eingesammelt und fuehren zum Wurf.
 */
export function liesJsonc(datei: string): unknown {
  const fehler: ParseError[] = [];
  const wert: unknown = parseJsonc(readFileSync(datei, "utf8"), fehler, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (fehler.length > 0) {
    const beschreibung = fehler
      .map((f) => `${printParseErrorCode(f.error)} bei Offset ${f.offset}`)
      .join(", ");
    throw new Error(`${datei} ist kein gueltiges JSONC (${beschreibung}). Fail-closed.`);
  }
  return wert;
}

/** Sammelt jede Zeichenkette unterhalb von `build`/`deploy`. */
function sammleBefehle(
  knoten: unknown,
  pfad: string,
  hinein: (feld: string, wert: string) => void,
): void {
  if (typeof knoten === "string") {
    hinein(pfad, knoten);
    return;
  }
  if (Array.isArray(knoten)) {
    knoten.forEach((kind, index) => sammleBefehle(kind, `${pfad}[${index}]`, hinein));
    return;
  }
  if (typeof knoten === "object" && knoten !== null) {
    for (const [schluessel, wert] of Object.entries(knoten as Record<string, unknown>)) {
      sammleBefehle(wert, pfad === "" ? schluessel : `${pfad}.${schluessel}`, hinein);
    }
  }
}

/**
 * Prueft die genannten Wrangler-Konfigurationen.
 *
 * @throws wenn die Liste leer ist oder eine Datei nicht parsebar ist —
 *         fail-closed, siehe Kopfkommentar.
 */
export function pruefeDeployAutoritaet(dateien: readonly string[]): DeployAuthorityFund[] {
  if (dateien.length === 0) {
    throw new Error(
      "Keine wrangler.jsonc gefunden. Der Waechter gegen eine zweite Migrationsautoritaet kann nichts pruefen und ist deshalb fail-closed rot.",
    );
  }
  const funde: DeployAuthorityFund[] = [];
  for (const datei of dateien) {
    const konfiguration = liesJsonc(datei) as Record<string, unknown>;
    for (const abschnitt of ["build", "deploy"]) {
      if (!(abschnitt in konfiguration)) continue;
      sammleBefehle(konfiguration[abschnitt], abschnitt, (feld, wert) => {
        for (const werkzeug of SCHEMA_WERKZEUGE) {
          if (wert.includes(werkzeug)) {
            funde.push({ datei, feld, werkzeug, wert });
          }
        }
      });
    }
  }
  return funde;
}

/**
 * Dieselbe Regel fuer die Containerwelt (EYT-126).
 *
 * Coolify und Railway starten Images; sie duerfen dabei so wenig eine zweite
 * Migrationsautoritaet werden wie ein Cloudflare-Build. Der Unterschied ist
 * nur das Format: `Dockerfile` und `docker-compose.yml` sind kein JSONC,
 * ihre Befehle stehen als Klartext in `RUN`, `CMD`, `ENTRYPOINT` oder
 * `command:`. Deshalb wird hier zeilenweise gelesen statt geparst.
 *
 * Kommentarzeilen werden uebersprungen. Sonst meldete der Waechter die
 * Begruendung, warum ein Werkzeug NICHT vorkommen darf, als Verstoss — und
 * ein Waechter, den man nur durch Verschweigen zufriedenstellt, erzieht zum
 * Verschweigen.
 *
 * Fail-closed genauso: leere Dateiliste oder eine unlesbare Datei sind rot.
 */
export function pruefeContainerDeployAutoritaet(dateien: readonly string[]): DeployAuthorityFund[] {
  if (dateien.length === 0) {
    throw new Error(
      "Keine Containerkonfiguration gefunden. Der Waechter gegen eine zweite Migrationsautoritaet kann nichts pruefen und ist deshalb fail-closed rot.",
    );
  }
  const funde: DeployAuthorityFund[] = [];
  for (const datei of dateien) {
    let inhalt: string;
    try {
      inhalt = readFileSync(datei, "utf8");
    } catch (fehler) {
      throw new Error(`${datei} ist nicht lesbar (${String(fehler)}). Fail-closed.`, {
        cause: fehler,
      });
    }
    const zeilen = inhalt.split("\n");
    zeilen.forEach((zeile, index) => {
      if (zeile.trimStart().startsWith("#")) return;
      for (const werkzeug of SCHEMA_WERKZEUGE) {
        if (zeile.includes(werkzeug)) {
          funde.push({ datei, feld: `Zeile ${index + 1}`, werkzeug, wert: zeile.trim() });
        }
      }
    });
  }
  return funde;
}
