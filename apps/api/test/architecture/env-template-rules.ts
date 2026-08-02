/**
 * Versionierte Environment-Vorlagen enthalten nur Platzhalter (EYT-133, F4).
 *
 * Kein `.test.ts`-Suffix: Helfer, keine Suite — dieselbe Konvention wie
 * `scan.ts`, `rules.ts`, `costs-rules.ts` und `secret-surface-rules.ts`.
 *
 * ## Warum es diese Datei gibt
 *
 * Am 02.08.2026 standen in einer lokal veraenderten, versionierten
 * Environment-Vorlage konkrete Zugangsdaten. Sie wurden vor jedem Commit
 * entfernt; nichts gelangte in die Historie. Der Wächter existiert, damit der
 * naechste Fall auffaellt, bevor jemand `git add` tippt.
 *
 * ## Warum nicht einfach gitleaks
 *
 * Gemessen mit gitleaks 8.24.3 gegen synthetische Werte:
 *
 *   JWT (jede Rolle)              GEFANGEN — eigene Regel `jwt`
 *   sb_secret_-Praefix            UEBERSEHEN
 *   sb_publishable_-Praefix       UEBERSEHEN
 *   einfaches Passwort            UEBERSEHEN
 *   Datenbank-URL mit Passwort    UEBERSEHEN
 *
 * Entropie faengt manches davon zufaellig — im echten Vorfall zwei von neun
 * Zeilen, in der synthetischen Probe keine. Laenge und Entropie sind also
 * kein Detektor, sondern ein Zufallsgenerator. Deshalb eine enge, eigene
 * Regel im Repository statt eines zweiten breiten Scanners neben gitleaks:
 * die beiden ueberlappten sonst grossflaechig und widersprächen einander.
 *
 * ## Die Trennung, um die es geht
 *
 *   `.env`, `.env.local`, …   von Git ignoriert, enthalten echte lokale
 *                             Geheimnisse, werden hier NIE gelesen.
 *   `.env.example` und andere VERSIONIERTE Vorlagen: werden vollstaendig
 *                             geprueft und duerfen nur Platzhalter tragen.
 *
 * Die Quelle der Wahrheit dafuer ist `git ls-files` — was Git kennt, ist
 * versioniert; was es nicht kennt, geht diesen Wächter nichts an.
 */

/** Zusammengesetzt, damit diese Datei nicht ihre eigenen Muster ausloest. */
const SB_GEHEIM_PRAEFIX = ["sb", "secret", ""].join("_");
const SB_OEFFENTLICH_PRAEFIX = ["sb", "publishable", ""].join("_");

export interface TemplateBefund {
  readonly datei: string;
  readonly zeile: number;
  readonly variable: string;
  readonly grund: string;
}

/**
 * Erlaubte Platzhalterformen.
 *
 * Bewusst eine Allowlist: eine Sperrliste muesste jede denkbare Geheimnisform
 * kennen, diese Liste muss nur die wenigen Formen kennen, die eine Vorlage
 * ueberhaupt braucht.
 */
export const ERLAUBTE_PLATZHALTER: ReadonlyArray<{ muster: RegExp; name: string }> = [
  { muster: /^$/, name: "leer" },
  { muster: /^replace-with[\w.-]*$/i, name: "replace-with-…" },
  { muster: /^<[^>]*>$/, name: "<…>" },
  { muster: /^example[\w.-]*$/i, name: "example-…" },
  { muster: /^your-[\w.-]*$/i, name: "your-…" },
  { muster: /^changeme$/i, name: "changeme" },
];

/**
 * Ausdruecklich freigegebene lokale Dummy-Konstanten.
 *
 * Der lokale Supabase-Stack hat feste, oeffentlich dokumentierte Koordinaten.
 * Sie sind keine Geheimnisse und muessen in der Vorlage stehen duerfen, sonst
 * waere die Vorlage als Anleitung wertlos.
 */
export const ERLAUBTE_DUMMY_WERTE: ReadonlyArray<{ muster: RegExp; grund: string }> = [
  {
    muster: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/,
    grund: "lokale Stackadresse ohne Zugangsdaten",
  },
  { muster: /^(development|test|production)$/, grund: "NODE_ENV-Wert" },
  { muster: /^(fatal|error|warn|info|debug|trace)$/, grund: "LOG_LEVEL-Wert" },
  { muster: /^\d{2,5}$/, grund: "Portnummer" },
];

export interface Wertform {
  readonly jwtRolle: string | null;
  readonly istGeheimPraefix: boolean;
  readonly istOeffentlichPraefix: boolean;
  /** Passwortanteil einer Datenbank-URL, falls vorhanden. */
  readonly dbPasswort: string | null;
}

function base64UrlDekodieren(teil: string): string | null {
  try {
    const gefuellt = teil + "=".repeat((4 - (teil.length % 4)) % 4);
    return Buffer.from(gefuellt, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Klassifiziert einen Wert LOKAL. Dekodiert einen JWT nur so weit, dass die
 * Rolle sichtbar wird — Payload, Claims und Projektbezug verlassen diese
 * Funktion nie.
 */
export function klassifiziereWert(wert: string): Wertform {
  let jwtRolle: string | null = null;
  const teile = wert.split(".");
  if (teile.length === 3 && teile[0]?.startsWith("eyJ") === true) {
    const nutzlast = base64UrlDekodieren(teile[1] as string);
    jwtRolle = "nicht feststellbar";
    if (nutzlast !== null) {
      try {
        const rolle = (JSON.parse(nutzlast) as { role?: unknown }).role;
        if (typeof rolle === "string") jwtRolle = rolle;
      } catch {
        /* bleibt "nicht feststellbar" */
      }
    }
  }

  const dbTreffer = /^[a-z+]+:\/\/[^/\s:@]+:([^@\s]+)@/.exec(wert);

  return {
    jwtRolle,
    istGeheimPraefix: wert.startsWith(SB_GEHEIM_PRAEFIX),
    istOeffentlichPraefix: wert.startsWith(SB_OEFFENTLICH_PRAEFIX),
    dbPasswort: dbTreffer?.[1] ?? null,
  };
}

export function istPlatzhalter(wert: string): boolean {
  return ERLAUBTE_PLATZHALTER.some((p) => p.muster.test(wert));
}

function istErlaubterDummy(wert: string): boolean {
  return ERLAUBTE_DUMMY_WERTE.some((d) => d.muster.test(wert));
}

/**
 * Variablennamen, deren Wert in einer Vorlage zwingend Platzhalter sein muss.
 * Zusammengesetzt, damit diese Datei nicht selbst anschlaegt.
 */
const GEHEIME_NAMENSTEILE = [
  ["PASS", "WORD"].join(""),
  ["SECRET"].join(""),
  ["TOKEN"].join(""),
  ["SERVICE", "KEY"].join("_"),
  ["SERVICE", "ROLE"].join("_"),
  ["ANON", "KEY"].join("_"),
  ["API", "KEY"].join("_"),
];

export function istGeheimerName(variable: string): boolean {
  return GEHEIME_NAMENSTEILE.some((teil) => variable.toUpperCase().includes(teil));
}

/**
 * Prueft den Inhalt EINER versionierten Vorlage.
 *
 * Auch auskommentierte Zeilen werden geprueft: ein `#` vor einer echten
 * Zugangsdatenzeile macht sie nicht ungefaehrlich, nur unauffaelliger.
 */
export function pruefeEnvTemplate(datei: string, inhalt: string): TemplateBefund[] {
  const befunde: TemplateBefund[] = [];
  inhalt.split("\n").forEach((zeile, index) => {
    const treffer = /^\s*#?\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(zeile);
    if (treffer === null) return;
    const variable = treffer[1] as string;
    const wert = (treffer[2] as string).trim().replace(/^["']|["']$/g, "");
    const nummer = index + 1;
    const melde = (grund: string): void => {
      befunde.push({ datei, zeile: nummer, variable, grund });
    };

    const form = klassifiziereWert(wert);

    // 1. Wertform — unabhaengig vom Variablennamen.
    if (form.jwtRolle !== null) {
      melde(`JWT in einer versionierten Vorlage (role=${form.jwtRolle})`);
      return;
    }
    if (form.istGeheimPraefix) {
      melde("Supabase-Geheimschluessel in einer versionierten Vorlage");
      return;
    }
    if (form.istOeffentlichPraefix) {
      // Technisch veroeffentlichbar, in DIESER Vorlage trotzdem nur Platzhalter.
      melde("konkreter Publishable-Key in einer versionierten Vorlage");
      return;
    }
    if (form.dbPasswort !== null && !istPlatzhalter(form.dbPasswort)) {
      melde("Datenbank-URL mit konkretem Passwort");
      return;
    }

    // 2. Geheime Variablennamen brauchen eine erlaubte Platzhalterform.
    if (istGeheimerName(variable) && wert !== "") {
      if (!istPlatzhalter(wert) && !istErlaubterDummy(wert)) {
        melde("geheimer Variablenname mit konkretem Wert statt Platzhalter");
      }
    }
  });
  return befunde;
}

export function renderTemplateBefunde(befunde: readonly TemplateBefund[]): string[] {
  return befunde.map((b) => `${b.datei}:${b.zeile} [${b.variable}] ${b.grund}`);
}
