import type { ReactNode } from "react";

/**
 * Shell der easyTree-Web-App (EYT-41): semantische Landmarks
 * (header/nav/main/footer), Skip-Link als erstes fokussierbares Element,
 * mobile-first Layout via globals.css. Bewusst als Server-Komponente
 * ohne Client-Logik.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#hauptinhalt">
        Zum Hauptinhalt springen
      </a>
      <header className="app-header">
        <span className="app-brand">easyTree</span>
        <nav aria-label="Hauptnavigation">
          <ul className="app-nav-list">
            <li>
              <a href="/" aria-current="page">
                Start
              </a>
            </li>
            <li>
              <a href="/#status">Status</a>
            </li>
          </ul>
        </nav>
      </header>
      <main id="hauptinhalt" tabIndex={-1} className="app-main">
        {children}
      </main>
      <footer className="app-footer">
        <p>easyTree — Web-Shell (Sprint 1, EYT-41)</p>
      </footer>
    </>
  );
}
