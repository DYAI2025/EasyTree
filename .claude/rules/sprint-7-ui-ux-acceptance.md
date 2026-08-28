# Sprint 7 UI/UX Acceptance Rule

## Status und Lebenszyklus

- Status: **ACTIVE_TEMPORARY**
- Applies to: EasyTree Jira Sprint 7, **Sprint ID 579**
- Primary acceptance issue: **EYT-148** („Sprint 7: Admin- und
  Mitarbeiter-User-Journeys vollständig mit Playwright und realer Persistenz
  abnehmen")
- Wächter: `apps/api/test/sprint7-acceptance-rule-guardrails.test.ts`
  (Pflichtjob `unit-tests`) — Entfernen, Umbenennen oder wesentliches
  Abschwächen dieser Datei macht CI rot.

**Removal Condition:** Diese Regel darf erst entfernt oder archiviert werden, nachdem Sprint 7 in Jira formal PO-abgenommen und geschlossen ist und alle wiederverwendbaren Anforderungen in dauerhafte Frontend-Qualitätsregeln überführt wurden.

## Quellen-Autorität (SSoT)

Diese Regel ist eine **Ausführungsregel für Coding Agents** — sie ist KEINE
neue Produkt-SSoT und ersetzt weder Jira noch Confluence.

- **Jira** (Projekt `EYT`, Board 72) besitzt Sprint-, Scope- und
  Acceptance-Wahrheit.
- **Confluence** besitzt die Design-/Architektur-Baselines: Seite `8814623`
  („EasyTree – Basisdesign v2.0: Werkbank & Feld – ruhig verdichtet") und
  Seite `8486960` („EasyTree – Zwei-Client-Architektur und Admin-Kalender").
- **GitHub** (`DYAI2025/EasyTree`, `origin/master`) besitzt Code-, Branch- und
  CI-Wahrheit.
- **Runtime-Evidenz** besitzt Deployment- und Runtime-Wahrheit.
- **Coding-Agent-Ausgaben sind keine SSoT.**

Vor jeder Sprint-7-Arbeit den aktuellen Jira-/GitHub-/Confluence-Stand frisch
lesen; Auftragsprämissen veralten vor der Ausführung.

## Product Truth

Sprint 7 liefert finale produktive Oberflächen: Admin/Werkbank **Desktop-first**,
Mitarbeiter/Feld **Mobile-Web-first**.

Nicht zulässig als Produktabnahme: Clickdummies, Fake-Daten, Mockserver,
Netzwerk-Fixtures als Ersatz für reale Journeys, Placeholder-Screens,
synthetische Erfolgsmeldungen, LocalStorage-/Clientzustände als operative
Wahrheit. Nicht implementierte Backend-/Domainfähigkeiten dürfen nicht durch UI
vorgetäuscht werden.

## Bestehende Testarchitektur

Vor Änderungen mindestens inspizieren: `apps/web/e2e/`,
`apps/web/playwright.config.ts`, `apps/web/playwright.harness.config.ts`,
`apps/web/e2e/auth-journey/`.

Der einfache `web-smoke` ohne echte API/DB ist kein vollständiger
Sprint-7-Abnahmenachweis. Für Acceptance-Journeys ist die vorhandene
Real-Stack-Infrastruktur zu bevorzugen:

Browser → Next/Web → reale API → reale Authentifizierung → PostgreSQL/RLS

Keine zweite parallele E2E-Testarchitektur aufbauen, solange die vorhandene
erweiterbar ist.

## Test-per-Increment

Jede tatsächlich veränderte produktive Oberfläche muss, soweit für den Slice
relevant, beweisen: (1) reale Nutzerhandlung; (2) erwartetes sichtbares
Ergebnis; (3) echte autorisierte API-/Domain-Ausführung; (4) Reload bestätigt
Serverzustand; (5) bei relevanten gemeinsamen Zuständen zusätzlicher
Browserkontext; (6) Negativ-/Rechtereise; (7) finale Darstellung im
Basisdesign v2.0; (8) Responsive-Verhalten; (9) Accessibility;
(10) Screenshot aus der real ausgeführten Journey.

EYT-148 ist das finale aggregierte Gate, aber die Tests dürfen nicht bis zum
Sprintende aufgeschoben werden.

## Viewports

- Admin: Chromium `1440 × 900` und `1920 × 1080`.
- Mitarbeiter: Chromium Touch `320 × 800` und `375 × 812`.
- Sprint-Closeout zusätzlich gezielte WebKit-Smokes (Mitarbeiter `375 × 812`,
  Admin `1440 × 900`), soweit die vorhandene Infrastruktur das robust zulässt.
- Keine unnötige vollständige Browsermatrix bauen.
- Reproduzierbare Acceptance-Läufe: Locale `de-DE`, Timezone `Europe/Berlin`.

## Accessibility

Für tatsächlich verwendete produktive Flächen prüfen: axe A/AA;
Tastaturbedienbarkeit; sichtbarer Fokus; sinnvolle semantische Reihenfolge;
Status nie ausschließlich über Farbe; kein unkontrolliertes horizontales
Seitenscrolling; mobile Hauptaktionen mindestens 56 px; Desktop-Aktionen
mindestens 40 px; keine erforderliche Hover-only-Bedienung auf Mobile;
`prefers-reduced-motion`; Klick-/Tastaturalternative für Drag-and-Drop.

**200-%-Zoom:** Ein automatisierter Reflow-Test ist zulässig, darf aber NICHT
als identisch mit realem Browserzoom bezeichnet werden. Der finale
PO-Acceptance-Report muss einen echten menschlichen 200-%-Zoom-Check als
Reviewpunkt enthalten.

## Zustände (States)

Wo der reale Vertrag den Zustand erzeugen kann: Loading, Empty, Error,
Forbidden, Unauthenticated, Stale, Partial, Retry. `Offline-read-only` nur
dort, wo eine reale fachliche Offline-Lesefähigkeit existiert — keine
Offline-Funktion erfinden, nur damit ein UI-State gezeigt werden kann.

## Visual Regression

Screenshots müssen aus realen Produktjourneys stammen. Keine Figma-, Penpot-,
Storybook- oder Mockup-Screenshots als Ersatz für Produktabnahme.

Verbindlicher Ablauf:

candidate screenshot → READY_FOR_PO_VISUAL_REVIEW → explicit human PO
approval → accepted golden baseline

Eine neue oder geänderte Golden Baseline benötigt explizite menschliche PO-Freigabe; ein automatisches Baseline-Update (etwa via --update-snapshots) ist verboten. Coding Agents dürfen einen Visual-Test niemals durch ein
Baseline-Update „reparieren".

## Browser Integrity

In positiven Journeys relevante Fehler überwachen: `pageerror`, unerwartete
`console.error`, unerwartete HTTP 5xx, fehlgeschlagene kritische Ressourcen,
Hydrationfehler, unerwartete Weiterleitungen. Negative Journeys müssen
erwartete 401/403- bzw. Forbidden-Zustände explizit beweisen.

## Autorisierung

Eine sichtbare Navigation oder Route verleiht niemals Rechte. Insbesondere:
Mitarbeiter erhalten keine Admin-/Kosten-/fremden Organisationsdaten; ohne
`costs.read` keine Kostenbeträge oder Kostensätze; Kosten-Navigation und
Kosteninhalte gemäß EYT-113 nur nach verifiziertem Recht. Serverseitige
Autorisierung bleibt bindend.

## EYT-148 Final Journey Gate

Der finale Sprint-7-Kandidat muss mindestens beweisen —

**Admin:** reales Login → zulässige Admin-Shell → Woche/Planung → realen
Einsatz anlegen → bestätigten Serverzustand sehen → Reload →
Konflikt-/Fehlerfall → konfliktfreien Plan veröffentlichen → veröffentlichten
Stand lesen → mit `costs.read` Kosten/Snapshot lesen → ohne `costs.read` kein
erfolgreicher Kosten-Zugriff.

**Mitarbeiter:** reales Login → Feld-Shell → Heute → ausschließlich eigene
autorisierte reale Daten → Woche, soweit der reale Employee-Read-Pfad
implementiert ist → Reload → gleicher Serverzustand → kein
Admin-/Kosten-/Fremddatenzugriff.

Noch nicht implementierte Fachfunktionen dürfen nicht als Fake-Journey ergänzt
werden.

## PO Acceptance Evidence

Für den finalen Sprint-Kandidaten muss ein Evidence Package erzeugbar sein,
mindestens mit: `manifest.json`, `PO-ABNAHME.md`, Playwright-Ergebnis,
relevanten Server-/Plan-/Snapshot-IDs, Admin-Screenshots,
Mitarbeiter-Screenshots, State-Screenshots, Accessibility-Ergebnissen,
Visual-Diff-Ergebnissen, Traces bei Fehlern, Video der kanonischen
Admin-Journey, Video der kanonischen Mitarbeiter-Journey.

Das Manifest bindet mindestens: Git SHA, getestete Umgebung, Browser und
Version, Viewport, Rolle, Zeitpunkt, relevante Server-IDs,
Testdaten-/Seed-Bezug. Große Laufartefakte nicht ungeprüft dauerhaft ins
Repository committen; bevorzugt CI-Artefakte.

## Human Gate

Coding Agents dürfen technische Ergebnisse als PASS melden. Coding Agents
dürfen NICHT selbst setzen oder behaupten: „PO approved", „UX accepted",
„UI accepted", „design accepted", „Sprint 7 accepted".

Ein Coding Agent kann keine PO-/UI-/UX-Abnahme erzeugen; die visuelle und UX-seitige Sprintfreigabe ist Human-/PO-only.

Der höchste Agenten-Endstatus vor menschlicher Designabnahme lautet:

READY_FOR_PO_VISUAL_REVIEW
