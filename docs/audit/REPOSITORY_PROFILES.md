# Repository-Profile

## 1. EasyTree-master – technische Foundation

**Rolle:** kanonischer technischer Kern und Zielbasis für die Produktintegration.

**Quelleinspiziert:**

- pnpm-/Turborepo-Monorepo mit `apps/api`, `apps/web`, `packages/config`, `packages/ui` und `supabase`.
- NestJS-API mit Health/Readiness, Worker-Einstieg, Correlation-ID und Fehlerhülle.
- Next.js-Web-/PWA-Shell mit API-Client-Injektion und Guard gegen direkten Supabase-Zugriff aus der UI.
- Supabase/PostgreSQL-Foundation mit Tenant-/RLS-Grundlage und Tests.
- PRD v1.3, MVP-Scope, Architekturentscheidungen, Clickdummy-Anforderungen und Traceability.
- Testdateien für API, Web, Konfiguration, UI und Datenbank sind vorhanden.

**Noch nicht Produkt-MVP:**

- Keine fachlichen APIs für Mitarbeiter, Baustellen, Einsätze, Planversionen, Abwesenheiten, Ressourcen, Arbeitszeiten oder Wetter.
- Datenbankschema enthält überwiegend generische Foundation-Entitäten statt des vollständigen Arboscus/EasyTree-Domänenmodells.
- Web-App ist eine technische Shell, kein operativer Planer oder Mitarbeiter-Client.

**Clickdummy-Nutzen:** gering als visuelles Produkt, hoch als Integrations- und Qualitätsfundament.

**Wichtige Drift:** README und technische Unterlagen verwenden unterschiedliche Repository-/Produktidentitäten (`EasyTree`, `Arborga`, `Arboscus`). Das muss vor Merge und Jira-Verknüpfung geklärt werden.

---

## 2. EasyTree-UIUX – Planer- und Management-Clickdummy

**Rolle:** visuelle und interaktive Referenz für Administrator/Geschäftsführung/Disposition.

**Quelleinspiziert:**

- Vite/React/TypeScript-Prototyp.
- Monats-, Wochen- und Vier-Wochen-Ansichten.
- Mitarbeiter-, Baustellen-, Fahrzeug-, Geräte-, Abwesenheits- und Wetter-Mockdaten.
- Konflikt- und Kapazitätslogik im Browser.
- Filter, Summen, Undo/Redo, Schnellanlage, Detail-Drawer, CSV-Export und simulierte Veröffentlichung.
- Eine Domain-Testdatei ist vorhanden.

**Stärken für Clickdummy:**

- deckt den visuellen Kern der Planeransicht bereits gut ab;
- zeigt Konflikte und Veröffentlichungsblocker verständlich;
- eignet sich als Diskussionsgrundlage für GF/Admin.

**Kritische Lücken/Fehler:**

1. Wochenstunden werden über den gesamten übergebenen Zuweisungsbestand summiert, nicht sauber pro Kalenderwoche. Dadurch können falsche Blocker entstehen.
2. Gleiches Start- und Enddatum wird als 24 Stunden interpretiert; ungültige Zeitwerte werden nicht robust abgelehnt.
3. Ressourcenauslastung wertet mehrere Reservierungen am selben Tag pauschal als Doppelbelegung, auch wenn sie zeitlich nacheinander liegen.
4. Karten-/Geocoding-Aufrufe erfolgen direkt aus dem Browser gegen öffentliche Dienste; Provider-, Datenschutz-, Rate-Limit- und Adaptergrenzen fehlen.
5. Ausgewählte Koordinaten werden im Worksite-Typ nicht persistiert.
6. Veröffentlichung, Rollen und Benachrichtigungen sind Simulationen, keine serverseitigen Geschäftsprozesse.
7. Kein Authentifizierungs-, Mandanten-, Berechtigungs-, Audit- oder Versionsmodell.

**Clickdummy-Nutzen:** hoch für Planer/GF, aber fachliche Ergebnisse dürfen nicht als valide Planung behandelt werden.

---

## 3. EasyTree-App-UI – mobile Mitarbeiter-App

**Rolle:** mobile Clickdummy-Referenz für Mitarbeitende im Feld.

**Quelleinspiziert:**

- Vite/React/TypeScript-Prototyp im mobilen Geräteframe.
- Startseite, Woche, Baustellendetail, Wetter, Nachrichten, Abwesenheit, Profil, Schadensmeldung und Timer.
- Wochenbestätigung und begründete Ablehnung.
- Local-Storage-Persistenz für Demo-Zustände.

**Stärken für Clickdummy:**

- bildet den mobilen Mitarbeiterkontext deutlich besser ab als das Master-Repo;
- zeigt wichtige Feldinformationen kompakt;
- enthält Bestätigung, Ablehnung, Abwesenheit, Timer und Zustandsmeldung.

**Kritische Lücken/Fehler:**

1. Kein API-Client, keine Authentifizierung, keine serverseitige Berechtigung.
2. Offline-Modus ist ein manuell gesetzter Demo-Schalter; keine echte Netzwerkerkennung, Cache-Strategie, Command Queue oder Synchronisation.
3. Profil behauptet „Installierbar (Offline PWA)“ und automatische Synchronisation, obwohl Manifest, Service Worker und Sync-Mechanismus fehlen. Diese Aussage ist durch den Quelltext widersprochen.
4. Timer zählt nur per `setInterval` im laufenden Browser und speichert eine lokalisierte Anzeigezeit statt eines belastbaren Zeitstempels. Hintergrund/Neustart kann Dauer verfälschen.
5. Demo-Reset ruft `localStorage.clear()` auf und löscht damit potenziell fremde Origin-Daten.
6. Foto/Audio in der Schadensmeldung sind externe Demo-Assets, keine Aufnahme-, Upload- oder Transkriptionsfunktion.
7. Keine administrative Arbeitszeitfreigabe oder Korrektur mit Originalerhalt.

**Clickdummy-Nutzen:** hoch für Mitarbeitertests, aber nur als `fake-only`/Prototyp-Evidenz.
