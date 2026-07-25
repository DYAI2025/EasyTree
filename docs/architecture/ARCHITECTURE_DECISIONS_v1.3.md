# Arboscus Teamplaner – Architektur-, Provider- und Betriebsentscheidungen

Stand der Entscheidungen: 23.07.2026 · Dokumentversion: v1.3 (26.07.2026)

> **Versionshinweis:** Dieses Dokument hieß bis 26.07.2026 `ARCHITECTURE_DECISIONS_v1.2.md`.
> Angeglichen an die einheitliche Dokumentversion v1.3; die Entscheidungen selbst sind
> **unverändert** und stammen weiterhin vom 23.07.2026. Einzige inhaltliche Korrektur: der
> Repository-Name (siehe unten). Ergänzt, nicht ersetzt, wird dieses Dokument durch
> [ADR-001](./ADR-001-boilerplate-architecture.md) — ADR-001 regelt die Boilerplate-Architektur,
> dieses Dokument die Provider-, Hosting-, Retention- und Pilotentscheidungen.

## Verbindlich

- Repository: `DYAI2025/EasyTree` (bis 25.07.2026 `DYAI2025/Arborga`; GitHub leitet den alten
  Namen weiter, kanonisch ist `EasyTree`)
- Datenbankplattform: Supabase Postgres
- Zielregion: Central EU / Frankfurt
- mobile-first installierbare Web-App
- serverseitige Autorisierung und Row Level Security
- externe Dienste hinter austauschbaren Adaptern
- keine Mitarbeiterortung für Wetter oder Anfahrtszeit
- getrennte Entwicklungs-, Test- und Produktionsumgebungen

## Empfohlene Zielarchitektur

```text
Web/PWA und serverseitige API
  ├─ Supabase Postgres, Auth und private Storage-Buckets
  ├─ E-Mail-Adapter
  ├─ Routing-Adapter
  ├─ Wetter-/Ozon-Adapter
  ├─ DWD-Warnungsadapter
  └─ Python-Worker
       ├─ lokale Transkription
       ├─ geplante Wetterabrufe
       ├─ Benachrichtigungen
       └─ Lösch- und Backup-Jobs
```

Startpunkt ist ein TypeScript-first modularer Monolith. Ein separater Python-Worker wird nur für klar begründete Aufgaben eingesetzt. Microservices, Kubernetes, Event Sourcing oder zusätzliche Laufzeiten sind keine Defaults.

## Supabase

- Postgres als transaktionale Quelle der Wahrheit;
- Supabase Auth als bevorzugte Authentifizierung;
- private Storage-Buckets;
- RLS auf allen exponierten Tabellen und privaten Buckets;
- Service-Keys ausschließlich serverseitig;
- Datenbank- und Datei-Backups getrennt planen;
- Restore von Daten und Dateien vor Produktion testen.

## Wetter

Empfohlene Trennung:

- Prognose und Ozon über einen kostengünstigen Wetteradapter;
- amtliche Warnungen über DWD CAP/Open Data;
- Wetterabrufe zentral je Baustelle, nicht je Mitarbeiter;
- Prognose regelmäßig und bedarfsgerecht aktualisieren;
- amtliche Warnungen in kürzerem Intervall prüfen;
- Datenalter und Provider-Ausfall sichtbar machen.

Wetter ist im MVP informativ. Offizielle Warnungen werden prominent dargestellt, erzeugen aber keine automatische Einsatzabsage oder Arbeitsstopp-Entscheidung.

## Transkription

- bevorzugt lokales `faster-whisper`;
- deutsche Sprache als Standard;
- Nutzer prüft und bestätigt das Transkript;
- manuelle Texteingabe bleibt Fallback;
- Roh-Audio wird nach Bestätigung entsprechend der Löschregel entfernt.

## Routing

- privater Startpunkt je Nutzer;
- serverseitiger, austauschbarer Routing-Adapter;
- keine Weitergabe des privaten Startpunkts an Kollegen;
- kein kontinuierliches GPS und keine automatische Anwesenheitserkennung.

## PDF und Import

- PDF aus einer berechtigungsgefilterten HTML-Druckansicht;
- begrenzter CSV-Import mit Vorschau, Validierung, Fehlerliste und expliziter Bestätigung;
- kein Teilimport mit stillen Fehlern.

## Monitoring

Zu überwachen sind insbesondere Authentifizierung, Autorisierung, Planveröffentlichung, Konflikte, Benachrichtigungen, Timer, externe Provider, Wetteralter, Backup, Restore und Hintergrundjobs. Logs dürfen keine unnötigen Personaldaten, privaten Adressen, Tokens, Roh-Audio oder sensible Freitexte enthalten.

## Vorläufige Retention-Arbeitswerte

Diese Werte sind noch rechtlich zu prüfen:

| Kategorie                     |                                                Vorläufiger Wert |
| ----------------------------- | --------------------------------------------------------------: |
| Arbeitszeiten und Freigaben   |                                              mindestens 2 Jahre |
| Einsatz- und Planungshistorie |                                           3 Jahre vorgeschlagen |
| Urlaub und Abwesenheit        |                                           3 Jahre vorgeschlagen |
| reiner Krankheitsstatus       | möglichst kurz, vorgeschlagen maximal 12 Monate nach Jahresende |
| Zustandsmeldungen und Fotos   |                            3 Jahre nach Abschluss vorgeschlagen |
| Audit-Einträge                |                                           3 Jahre vorgeschlagen |
| Security- und Zugriffslogs    |                                                         90 Tage |
| Benachrichtigungsdaten        |                                                         90 Tage |
| Roh-Audio                     |                    nach Bestätigung, spätestens nach 24 Stunden |
| Wettercache                   |                                   48 Stunden bis maximal 7 Tage |
| Backups                       |                                rollierend 30 Tage vorgeschlagen |

## Noch offen

- finaler Hosting-ADR;
- E-Mail-System;
- endgültiger Wetterprovider für Prognose und Ozon;
- Browser-Push und Gesehen-Markierung für Wetterwarnungen;
- rechtsgeprüfte Retention;
- konkrete SLOs und Pilot-Zielwerte.
