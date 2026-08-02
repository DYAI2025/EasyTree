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
 * Konkrete Werte, die AUSSCHLIESSLICH fuer ihren eigenen Variablennamen
 * zulaessig sind.
 *
 * Der Vorgaenger war eine globale Liste ohne Namensbezug. Gemessen auf master
 * 36384d0 rutschten dadurch alle sechs Bypaesse durch: `production` ist als
 * NODE_ENV-Wert freigegeben und deckte damit jeden Namen, auch einen
 * Service-Schluessel. Die Bindung an den Namen ist der ganze Fix.
 *
 * Namen, die hier nicht stehen und nicht geheim sind, duerfen einen konkreten
 * Wert tragen, solange keine Wertformpruefung greift — sonst waere jede neue
 * harmlose Variable ein Befund und die Regel wuerde aufgeweicht statt befolgt.
 */
export const ERLAUBTE_KONKRETWERTE: ReadonlyArray<{
  variable: RegExp;
  pruefe: (wert: string) => boolean;
  grund: string;
}> = [
  {
    variable: /^NODE_ENV$/,
    pruefe: (w) => /^(development|test|production)$/.test(w),
    grund: "die drei Presets aus packages/config",
  },
  {
    variable: /^LOG_LEVEL$/,
    pruefe: (w) => /^(fatal|error|warn|info|debug|trace)$/.test(w),
    grund: "die sechs Stufen des Loggers",
  },
  {
    variable: /^API_PORT$/,
    // Ganzzahlig und im gueltigen Bereich. Ein blosses \\d+ liesse 0 und
    // 65536 durch — beide sind keine Ports.
    pruefe: (w) => /^\d{1,5}$/.test(w) && Number(w) >= 1 && Number(w) <= 65535,
    grund: "Portnummer 1..65535",
  },
  {
    variable: /^SUPABASE_URL$/,
    pruefe: (w) => istLokaleAdresseOhneZugangsdaten(w),
    grund: "lokale Stackadresse ohne Zugangsdaten",
  },
];

/** http/https, Host nur lokal, KEINE Userinfo. */
function istLokaleAdresseOhneZugangsdaten(wert: string): boolean {
  let url: URL;
  try {
    url = new URL(wert);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

/**
 * `DATABASE_URL` bekommt eine eigene Pruefung, weil zwei Bedingungen
 * gleichzeitig gelten muessen: lokale Adresse UND ein Passwortanteil, der leer
 * oder ein erkannter Platzhalter ist. Ein konkretes Passwort bleibt verboten,
 * auch gegen localhost.
 */
function istZulaessigeBeispielVerbindung(wert: string): boolean {
  let url: URL;
  try {
    url = new URL(wert);
  } catch {
    return false;
  }
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return false;
  const passwort = decodeURIComponent(url.password);
  return passwort === "" || istPlatzhalter(passwort);
}

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
/**
 * Zeilenform einer versionierten Environment-Vorlage.
 *
 * Optionales `#` (auskommentierte Eintraege werden mitgeprueft — ein konkreter
 * Secret-Wert bleibt auch auskommentiert ein Befund), optionales `export`
 * (sonst waere `export NAME=wert` die Umgehung), dann ein permissiv geparster
 * Bezeichner. Ob der Name kanonisch ist, entscheidet KANONISCHER_NAME danach —
 * getrennt, damit eine abweichende Schreibweise gemeldet und nicht ignoriert
 * wird.
 */
const ZEILENFORM = /^\s*(#\s*)?(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** In diesem Repository sind nur GROSSBUCHSTABEN-Namen gueltig. */
const KANONISCHER_NAME = /^[A-Z][A-Z0-9_]*$/;

export function pruefeEnvTemplate(datei: string, inhalt: string): TemplateBefund[] {
  const befunde: TemplateBefund[] = [];
  inhalt.split("\n").forEach((zeile, index) => {
    const nummer = index + 1;
    const istKommentar = /^\s*#/.test(zeile);
    if (zeile.trim() === "") return;

    // Am Zeilenanfang verankert, nicht irgendwo in der Zeile gesucht.
    //
    // Das ist keine Stilfrage: `.env.example` Z. 18 traegt `user=postgres`
    // mitten in einem psql-Aufruf innerhalb eines Kommentars. Eine Grammatik,
    // die den Namen irgendwo sucht, meldet dort sofort einen Fehlalarm.
    const treffer = ZEILENFORM.exec(zeile);
    if (treffer === null) {
      // Reine Kommentare und Leerzeilen sind erlaubt — auch Kommentare, die
      // irgendwo ein `=` tragen. Eine NICHT kommentierte Zeile, die hier
      // ankommt, ist in dieser Dateiform aber weder Kommentar noch Leerzeile
      // noch Assignment. Sie still zu ueberspringen war Finding B: die Zeile
      // verschwand wortlos, samt ihrem Wert.
      if (!istKommentar) {
        befunde.push({
          datei,
          zeile: nummer,
          variable: "(unparsbar)",
          grund: "Zeile ist weder Kommentar, Leerzeile noch gueltiges Assignment",
        });
      }
      return;
    }

    const variable = treffer[3] as string;
    const wert = (treffer[4] as string).trim().replace(/^["']|["']$/g, "");
    const melde = (grund: string): void => {
      befunde.push({ datei, zeile: nummer, variable, grund });
    };

    // 0. Schreibweise. Ein kleingeschriebener Geheimnisname wurde vom alten
    //    Muster gar nicht erst erkannt — die billigste Umgehung ueberhaupt.
    //    (Ausgeschrieben steht er im roten Fall, nicht hier: diese Zeile liegt
    //    hinter dem Regex-Literal oben, und `entferneKommentare` entfernt ab
    //    dort keine Kommentare mehr. Fail-loud, gemessen — genau dieser
    //    Fehlalarm ist gerade aufgetreten.)
    //    In diesem Repository sind ausschliesslich kanonische Namen gueltig,
    //    also ist eine abweichende Schreibweise selbst der Befund.
    if (!KANONISCHER_NAME.test(variable)) {
      melde("Variablenname ist nicht kanonisch (nur Grossbuchstaben, Ziffern, Unterstrich)");
      return;
    }

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

    // 2. Geheime Namen: NUR leer oder eine erlaubte Platzhalterform.
    //
    // Steht bewusst VOR jeder Konkretwert-Freigabe. Genau hier lag F1: der
    // alte Code liess einen globalen Dummywert auch fuer diese Namen zu, und
    // damit war ein Service-Schluessel mit dem Wert eines NODE_ENV-Presets
    // gruen.
    //
    // Der Name wird hier NICHT ausgeschrieben: `entferneKommentare` kennt
    // keine Regex-Literale, und das `/^["']|["']$/g` weiter oben laesst es
    // ab dort in einem Schein-Stringzustand. Kommentare hinter dieser Zeile
    // werden deshalb nicht entfernt und ein ausgeschriebener Bezeichner
    // erzeugt einen Fehlalarm gegen die eigene Datei. Fail-loud, nicht
    // fail-open — gemessen 02.08.2026, als eigener Befund gemeldet.
    if (istGeheimerName(variable)) {
      if (wert !== "" && !istPlatzhalter(wert)) {
        melde("geheimer Variablenname mit konkretem Wert statt Platzhalter");
      }
      return;
    }

    // 3. Verbindungszeichenkette: lokale Adresse UND leeres oder
    //    platzhalterartiges Passwort.
    if (/^DATABASE_URL$/.test(variable)) {
      if (wert !== "" && !istPlatzhalter(wert) && !istZulaessigeBeispielVerbindung(wert)) {
        melde("Verbindungszeichenkette ist weder Platzhalter noch lokales Beispiel ohne Passwort");
      }
      return;
    }

    // 4. Alle uebrigen Namen: ein konkreter Wert braucht eine Freigabe, die
    //    auf GENAU DIESEN Namen passt.
    if (wert === "" || istPlatzhalter(wert)) return;
    const freigabe = ERLAUBTE_KONKRETWERTE.find((e) => e.variable.test(variable));
    if (freigabe === undefined) {
      // Finding A: frueher fiel genau dieser Fall durch. Geprueft wurde nur,
      // wer ohnehin schon eine Freigabe hatte — die unbekannten Namen, um die
      // es geht, waren damit gerade nicht abgedeckt. Ein Konkretwert ohne
      // namensgebundene Freigabe ist jetzt der Befund.
      melde("konkreter Wert besitzt keine variablenspezifische Freigabe");
      return;
    }
    if (!freigabe.pruefe(wert)) {
      melde(`konkreter Wert ausserhalb der Freigabe fuer ${variable} (${freigabe.grund})`);
    }
  });
  return befunde;
}

export function renderTemplateBefunde(befunde: readonly TemplateBefund[]): string[] {
  return befunde.map((b) => `${b.datei}:${b.zeile} [${b.variable}] ${b.grund}`);
}
