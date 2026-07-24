# Accessibility-Checkliste — Web-Shell (EYT-41)

Ergänzt die automatisierten jsdom-Tests (`apps/web/test/a11y.test.tsx`). Seit
Sprint 2 laufen die Punkte 1–6 zusätzlich als **Echt-Browser-Tests** in
`apps/web/e2e/shell-smoke.spec.ts` (Playwright/Chromium gegen den
Produktions-Build, CI-Job `web-smoke`, merge-blockierend) — sie sind damit
reproduzierbar belegt und regressionsgesichert, nicht nur einmalig geklickt.

**Status (Stand 2026-07-24):** Punkte 1–6 bestanden (echter Chromium,
Prüfer: Claude via Playwright/axe, Sprint-2-Branch `feat/sprint-2-quality-gates`;
Dauerbeweis = grüner CI-Job `web-smoke`). **Punkt 7 offen** — Screenreader-Smoke
erfordert einen Menschen mit assistiver Technologie (VoiceOver/NVDA) und ist
nicht seriös automatisierbar. Bis zur Durchführung oder einem schriftlichen
PO-Descoping bleibt EYT-41 nicht abnehmbar.

| #   | Prüfung            | Erwartung                                                                                                                                                          | Status                                                                                                                                                 |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Tastaturbedienung  | Alle interaktiven Elemente (Skip-Link, Navigation, Buttons) sind ausschließlich per Tastatur erreichbar und auslösbar; keine Tastaturfallen                        | bestanden 2026-07-24 — e2e „Tab-Zyklus: alle interaktiven Elemente erreichbar …“ (vollständiger Tab-Walk über alle fokussierbaren Elemente)            |
| 2   | Fokusreihenfolge   | Tab-Reihenfolge folgt der visuellen/logischen Reihenfolge: Skip-Link → Navigation → Hauptinhalt; Skip-Link springt zu `#hauptinhalt` und der Fokus landet dort     | bestanden 2026-07-24 — e2e „Skip-Link ist erstes Tab-Ziel …“ + Tab-Zyklus (DOM-Reihenfolge == Fokusreihenfolge, Skip-Link zuerst)                      |
| 3   | Sichtbarer Fokus   | Jedes fokussierte Element zeigt einen deutlich sichtbaren Fokusindikator (Outline, ausreichender Kontrast)                                                         | bestanden 2026-07-24 — e2e prüft Outline/Box-Shadow auf **jedem** Tab-Stopp                                                                            |
| 4   | 200 %-Zoom         | Bei 200 % Browser-Zoom (und 320 px Viewportbreite) kein Layoutbruch, kein horizontales Scrollen für Fließtext, keine überlappenden/abgeschnittenen Inhalte         | bestanden 2026-07-24 — e2e 320-px-Reflow (WCAG-1.4.10-Äquivalent zu 200 % Zoom) und 375 px, jeweils ohne horizontales Scrollen                         |
| 5   | Non-color Status   | Statusanzeigen (z. B. API-Status) sind ohne Farbwahrnehmung verständlich: Text + Symbol tragen die Information, Farbe ist nur Verstärkung                          | bestanden 2026-07-24 — e2e: `role=status` trägt Textinhalt („API nicht erreichbar“-Zustand wird gerendert und geprüft)                                 |
| 6   | Farbkontrast       | Text- und Bedienelement-Kontraste erfüllen WCAG AA (axe-Regel `color-contrast` ist in jsdom deaktiviert und wird deshalb im echten Browser geprüft)                | bestanden 2026-07-24 — e2e axe-Scan (wcag2a/wcag2aa inkl. `color-contrast`) im echten Chromium: 0 Violations                                           |
| 7   | Screenreader-Smoke | Mit einem Screenreader (z. B. VoiceOver/NVDA): Landmarks (banner/navigation/main/contentinfo) werden angesagt, Seitentitel und Überschriftenstruktur sind sinnvoll | **offen** — menschliche Prüfung mit AT erforderlich (≈ 5 Min VoiceOver: `Cmd+F5`, mit `Ctrl+Opt+U` Landmark-Rotor); danach Datum + Prüfer:in eintragen |

Befund aus Sprint 2 (behoben): fehlendes Favicon führte zu einem 404 bei jedem
Browser-Load — gefixt in `apps/web/app/layout.tsx` (`icons` → vorhandenes
`/icons/icon.svg`), Commit `b6ffe97`.

Durchführung Punkt 7: `pnpm --filter @easytree/web dev`, dann
http://localhost:3000 mit Screenreader prüfen. Befunde als Jira-Bugs unter
EYT-41/Epic EYT-2 erfassen und diese Tabelle aktualisieren.
