import type { ReactNode } from "react";

export interface AppShellProps {
  /**
   * Beschriftung des Sprungankers. Bewusst PFLICHT und ohne Vorgabe: eine
   * deutsche Vorgabe hier waere Produkttext im domaenenfreien Paket und wuerde
   * die Wortwahl der Werkbank stillschweigend in die Feld-App tragen.
   */
  skipLinkLabel: string;
  /** Marken-/Logobereich links im Kopf. */
  brand: ReactNode;
  /**
   * Navigationsbereich. Der Rahmen stellt ihn nur hin — WELCHE Punkte darin
   * stehen und nach welchen Rechten gefiltert wird, entscheidet die Anwendung.
   * Auch das `<nav>` samt zugaenglichem Namen gehoert dorthin: der Rahmen
   * kennt die Sprache der Anwendung nicht.
   *
   * Anders als `sessionArea` wird dieser Slot OHNE Huelle ausgegeben — das
   * `<nav>` der Anwendung ist damit direktes Flex-Kind der Kopfleiste, worauf
   * sich deren Regeln stuetzen. Eine Zusicherung im Test haelt das fest.
   */
  navigation?: ReactNode;
  /** Rechter Kopfbereich — Sitzung, Organisation, Abmelden. */
  sessionArea?: ReactNode;
  /**
   * Fusszeile. Nur eine ABWESENDE Fusszeile (`undefined`, `null` oder `false`)
   * laesst die contentinfo-Landmark ganz entfallen — siehe `fehlt`.
   */
  footer?: ReactNode;
  /**
   * id der main-Landmark UND Ziel des Sprungankers — EIN Wert, nicht zwei
   * Literale, die auseinanderlaufen koennen.
   *
   * Der Vorgabewert ist der einzige des Rahmens, und zwar nicht weil er
   * "keine Sprache" waere — nach dem Sprung steht `#hauptinhalt` sichtbar in
   * der Adresszeile —, sondern weil `apps/web` genau diesen Wert bereits an
   * vier Stellen festnagelt (gemessen 27.08.2026):
   * `test/a11y.test.tsx:80` (href), `test/a11y.test.tsx:90` (id),
   * `e2e/shell-smoke.spec.ts:65` (Locator) und `:68` (Fokus nach Enter) —
   * dazu `:142` als fuenfte. Zwei Pflichtjobs haengen daran; der Umbau der
   * Werkbank-Shell soll den Wert deshalb nicht bewegen muessen.
   */
  mainId?: string;
  children: ReactNode;
}

/**
 * Erkennt die drei IDIOME DER ABWESENHEIT — mehr nicht, und der Name sagt
 * bewusst nicht mehr zu.
 *
 * Abgedeckt ist genau das, womit eine aufrufende Anwendung "kein Slot"
 * ausdrueckt: das Prop gar nicht setzen (`undefined`), `bedingung ? <X/> :
 * null` (`null`) und `bedingung && <X/>` (`false`). Mit einer blossen
 * `=== undefined`-Pruefung entstuende aus den letzten beiden eine LEERE
 * contentinfo-Landmark, und axe meldet die nicht (gemessen 27.08.2026, auch
 * mit `best-practice`) — nur ein Test haelt das.
 *
 * NICHT abgedeckt und auch nicht abdeckbar: ein Slot, der lediglich zu nichts
 * RENDERT. Ein leerer String, ein leeres Fragment oder eine Komponente, die
 * `null` zurueckgibt, erzeugen die Huelle weiterhin. Von aussen ist das nicht
 * unterscheidbar — diese Pruefung sieht den Knoten, nicht sein Ergebnis. Das
 * ist eine Grenze der Pruefung, kein Versehen: `""` ist kein
 * Abwesenheits-Idiom, sondern ein Wert, den die Anwendung uebergeben hat, und
 * ein Primitive, das uebergebene Werte still verschluckt, raet. Die Grenze ist
 * in `test/app-shell.test.tsx` als Zusage festgenagelt.
 *
 * Deshalb auch keine blosse Wahrheitspruefung: die verschluckte zusaetzlich
 * `""` und `0` und machte den benannten Waechter zu einem `!slot`.
 */
function fehlt(knoten: ReactNode): boolean {
  return knoten === undefined || knoten === null || knoten === false;
}

/**
 * Der Anwendungsrahmen (Basisdesign v2.0 §3.1): Sprunganker, Kopfleiste mit
 * Marke/Navigation/Sitzungsbereich, Hauptbereich, optionale Fusszeile.
 *
 * Domaenenfrei im woertlichen Sinn: dieses Modul importiert `react` und sonst
 * nichts — keine Sitzung, keine Rechte, keinen Router, keinen Fachbegriff.
 * Erzwungen wird das von der Regel `ui-dependency-allowlist` im Pflichtjob
 * `unit-tests`, nicht von diesem Kommentar.
 *
 * Styling gehoert der Anwendung: das Paket vergibt nur `eyt-app-shell*`-Klassen,
 * die passenden Regeln entstehen mit dem Umbau der Werkbank-Shell in
 * `apps/web/app/globals.css`. Heute gibt es sie dort noch nicht
 * (`grep -cF "eyt-app-shell" apps/web/app/globals.css` = 0, gemessen
 * 27.08.2026).
 *
 * ## Zwei Vertraege, die man erst als naechster Aufrufer bemerkt
 *
 * (1) Dieser Rahmen ist das EINZIGE Primitive des Pakets ohne
 * `HTMLAttributes` — `grep -c HTMLAttributes packages/ui/src/*.tsx` liefert
 * hier 0 und bei allen zehn Geschwistern 2 (gemessen 27.08.2026). Er nimmt
 * deshalb weder `className` noch `id` noch `aria-*` entgegen. Das ist so
 * gewollt: er rendert ein Fragment, es gibt gar kein Wurzelelement, auf das
 * sich solche Attribute legen liessen. Wer Stil braucht, schreibt Regeln zu
 * den oben genannten Klassen.
 *
 * (2) Eben weil es ein Fragment ist, muessen die vier Elemente DIREKTE Kinder
 * eines Spalten-Flexcontainers sein. In `apps/web` leistet das
 * `apps/web/app/globals.css:83-88` (`body { display: flex; flex-direction:
 * column }`), worauf sich `.app-main { flex: 1 }` (`:147-148`) stuetzt, um die
 * Resthoehe zu tragen und die Fusszeile unten zu halten. Ein Feld-Client, der
 * `<AppShell>` in ein Huellen-`<div>` haengt, verliert dieses Layout —
 * lautlos, kein Test dieses Pakets kann das sehen.
 */
export function AppShell({
  skipLinkLabel,
  brand,
  navigation,
  sessionArea,
  footer,
  mainId = "hauptinhalt",
  children,
}: AppShellProps): ReactNode {
  return (
    <>
      <a className="eyt-app-shell__skip-link" href={`#${mainId}`}>
        {skipLinkLabel}
      </a>
      <header className="eyt-app-shell__header">
        <div className="eyt-app-shell__brand">{brand}</div>
        {navigation}
        {fehlt(sessionArea) ? null : <div className="eyt-app-shell__session">{sessionArea}</div>}
      </header>
      <main id={mainId} tabIndex={-1} className="eyt-app-shell__main">
        {children}
      </main>
      {fehlt(footer) ? null : <footer className="eyt-app-shell__footer">{footer}</footer>}
    </>
  );
}
