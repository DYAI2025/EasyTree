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
   */
  navigation?: ReactNode;
  /** Rechter Kopfbereich — Sitzung, Organisation, Abmelden. */
  sessionArea?: ReactNode;
  /** Fusszeile. Fehlt sie, entsteht gar keine contentinfo-Landmark. */
  footer?: ReactNode;
  /**
   * id der main-Landmark UND Ziel des Sprungankers — EIN Wert, nicht zwei
   * Literale, die auseinanderlaufen koennen. Das ist der einzige Vorgabewert
   * dieses Rahmens, weil er DOM-Vertrag ist und keine Sprache.
   */
  mainId?: string;
  children: ReactNode;
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
 * Styling gehoert der Anwendung: das Paket vergibt nur `eyt-app-shell*`-Klassen
 * (wie jedes andere Primitive hier auch), die Regeln stehen in
 * `apps/web/app/globals.css`.
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
        <span className="eyt-app-shell__brand">{brand}</span>
        {navigation}
        {sessionArea === undefined ? null : (
          <div className="eyt-app-shell__session">{sessionArea}</div>
        )}
      </header>
      <main id={mainId} tabIndex={-1} className="eyt-app-shell__main">
        {children}
      </main>
      {footer === undefined ? null : <footer className="eyt-app-shell__footer">{footer}</footer>}
    </>
  );
}
