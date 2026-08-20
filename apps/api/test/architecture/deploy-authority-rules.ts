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
 * Fail-closed: findet die Regel keine `wrangler.jsonc`, ist sie ROT. Sonst
 * wuerde ein Umbenennen der Dateien den Waechter still abschalten — genau das
 * Muster, das `CLAUDE.md` als vakuoses Gate verbietet.
 */
import { readFileSync } from "node:fs";

/** Werkzeuge, die Schema veraendern. Keines gehoert in einen Cloudflare-Build. */
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
 * Entfernt Zeilen- und Blockkommentare aus JSONC.
 *
 * Bewusst konservativ: Zeichenketten bleiben unangetastet, sonst wuerde ein
 * `https://…` in einem Wert als Kommentarbeginn gelesen.
 */
export function entferneJsoncKommentare(text: string): string {
  let ergebnis = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < text.length) {
    const zeichen = text[i] ?? "";
    if (inString) {
      ergebnis += zeichen;
      if (escaped) {
        escaped = false;
      } else if (zeichen === "\\") {
        escaped = true;
      } else if (zeichen === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (zeichen === '"') {
      inString = true;
      ergebnis += zeichen;
      i += 1;
      continue;
    }
    if (zeichen === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (zeichen === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    ergebnis += zeichen;
    i += 1;
  }
  return ergebnis;
}

/**
 * Entfernt abschliessende Kommata vor `}` oder `]`.
 *
 * JSONC erlaubt sie, `JSON.parse` nicht — und Prettier SETZT sie in
 * `wrangler.jsonc`. Ohne diesen Schritt scheitert der Waechter an der
 * Formatierung statt an seinem Gegenstand.
 */
export function entferneNachlaufendeKommata(text: string): string {
  // Zeichenkettenbewusst: ein naives `text.replace(/,(\s*[}\]])/g, "$1")`
  // wuerde auch in einem Wert wie "a, }" zuschlagen und den Inhalt der
  // Konfiguration veraendern, die der Waechter gerade beurteilen soll.
  const zeichen: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if (inString) {
      zeichen.push(c);
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      zeichen.push(c);
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] ?? "")) j += 1;
      const naechstes = text[j] ?? "";
      if (naechstes === "}" || naechstes === "]") continue; // Komma verwerfen
    }
    zeichen.push(c);
  }
  return zeichen.join("");
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
 * @throws wenn eine Datei fehlt — fail-closed, siehe Kopfkommentar.
 */
export function pruefeDeployAutoritaet(dateien: readonly string[]): DeployAuthorityFund[] {
  if (dateien.length === 0) {
    throw new Error(
      "Keine wrangler.jsonc gefunden. Der Waechter gegen eine zweite Migrationsautoritaet kann nichts pruefen und ist deshalb fail-closed rot.",
    );
  }
  const funde: DeployAuthorityFund[] = [];
  for (const datei of dateien) {
    const roh = readFileSync(datei, "utf8");
    const konfiguration = JSON.parse(
      entferneNachlaufendeKommata(entferneJsoncKommentare(roh)),
    ) as Record<string, unknown>;
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
