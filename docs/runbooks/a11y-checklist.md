# Manuelle Accessibility-Checkliste — Web-Shell (EYT-41)

Ergänzt die automatisierten Tests (`apps/web/test/a11y.test.tsx`: axe-Smoke mit 0
Violations, Skip-Link als erstes Tab-Ziel, `main`-Landmark, `html lang="de"`).
Automatisierte Checks ersetzen keine manuelle Prüfung — die folgenden Punkte sind
mit echtem Browser/Screenreader durchzuführen.

**Status: manuell noch offen** (Stand 2026-07-23 — noch von keinem Menschen mit
Browser/AT durchgeführt; nach Durchführung Datum + Prüfer:in eintragen).

| #   | Prüfung            | Erwartung                                                                                                                                                          | Status |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | Tastaturbedienung  | Alle interaktiven Elemente (Skip-Link, Navigation, Buttons) sind ausschließlich per Tastatur erreichbar und auslösbar; keine Tastaturfallen                        | offen  |
| 2   | Fokusreihenfolge   | Tab-Reihenfolge folgt der visuellen/logischen Reihenfolge: Skip-Link → Navigation → Hauptinhalt; Skip-Link springt zu `#hauptinhalt` und der Fokus landet dort     | offen  |
| 3   | Sichtbarer Fokus   | Jedes fokussierte Element zeigt einen deutlich sichtbaren Fokusindikator (Outline, ausreichender Kontrast)                                                         | offen  |
| 4   | 200 %-Zoom         | Bei 200 % Browser-Zoom (und 320 px Viewportbreite) kein Layoutbruch, kein horizontales Scrollen für Fließtext, keine überlappenden/abgeschnittenen Inhalte         | offen  |
| 5   | Non-color Status   | Statusanzeigen (z. B. API-Status) sind ohne Farbwahrnehmung verständlich: Text + Symbol tragen die Information, Farbe ist nur Verstärkung                          | offen  |
| 6   | Farbkontrast       | Text- und Bedienelement-Kontraste erfüllen WCAG AA (axe-Regel `color-contrast` ist in jsdom deaktiviert und MUSS manuell/im Browser geprüft werden)                | offen  |
| 7   | Screenreader-Smoke | Mit einem Screenreader (z. B. VoiceOver/NVDA): Landmarks (banner/navigation/main/contentinfo) werden angesagt, Seitentitel und Überschriftenstruktur sind sinnvoll | offen  |

Durchführung: `pnpm --filter @easytree/web dev`, dann http://localhost:3000 im
Browser prüfen. Befunde als Jira-Bugs unter EYT-41/Epic EYT-2 erfassen und diese
Tabelle aktualisieren.
