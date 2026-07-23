# Jira-Backlog Erstaufschlag – EYT

Datum: 23.07.2026  
Projekt: EYT – EasyTree  
Board: 72

Der Backlog wurde aus dem PRD v1.3 und den ergänzenden MVP-, Wetter-, Architektur- und Post-MVP-Entscheidungen abgeleitet. Er ist ein erster strukturierter Aufschlag und wird später fachlich verfeinert, geschätzt und in Sprints geschnitten.

## Epics

| Key | Epic | Scope |
|---|---|---|
| EYT-1 | Produktgrundlage, UX und Clickdummy | mobile Nutzerreisen und UX-Validierung |
| EYT-2 | Plattformgrundlage, Supabase und Berechtigungen | Architektur, Auth, Daten, RLS und Audit |
| EYT-3 | Wochenplanung, Baustellen und Einsatzsteuerung | Planungskern und Veröffentlichung |
| EYT-4 | Einsatzbestätigung, Benachrichtigungen und Abwesenheiten | Kommunikation und Verfügbarkeit |
| EYT-5 | Ressourcen und Fähigkeiten verwalten | Skills, Geräte und Fahrzeuge |
| EYT-6 | Arbeitszeit, Freigabe und Korrektur | Timer und Zeitprozess |
| EYT-7 | Baustellenwetter und amtliche Warnungen | Prognose, Ozon und DWD-Warnungen |
| EYT-8 | Erweiterte Funktionen des ersten Releases | PWA, Offline, Transkription, Routing, PDF und CSV |
| EYT-9 | Qualität, Datenschutz und Produktionsfreigabe | Tests, Retention, Pilot und Betrieb |
| EYT-10 | Post-MVP: Planungsökonomie und Maschinenverleih | interne Sätze, Aufwände und Verleiherlöse |

## Stories und Tasks

### EYT-1 – Produktgrundlage, UX und Clickdummy

- EYT-11 – Zentrale mobile Nutzerreisen als Clickdummy validieren
- EYT-12 – Outdoor- und Accessibility-Designregeln festlegen

### EYT-2 – Plattformgrundlage, Supabase und Berechtigungen

- EYT-13 – Technische Zielarchitektur und ADR-Paket erstellen
- EYT-14 – Benutzer, Mitarbeiter, Rollen und Berechtigungen verwalten
- EYT-15 – Supabase-Datenmodell, RLS und Audit-Grundlage implementieren

### EYT-3 – Wochenplanung, Baustellen und Einsatzsteuerung

- EYT-16 – Baustellen und Tätigkeiten verwalten
- EYT-17 – Mitarbeiter in Wochen- und Vier-Wochen-Planung zuweisen
- EYT-18 – Planungskonflikte erkennen und Wochenplan veröffentlichen

### EYT-4 – Einsatzbestätigung, Benachrichtigungen und Abwesenheiten

- EYT-19 – Veröffentlichte Einsätze bestätigen oder begründet ablehnen
- EYT-20 – Urlaub, Krankheit und weitere Abwesenheiten erfassen
- EYT-21 – In-App- und E-Mail-Benachrichtigungen mit 24-Stunden-Eskalation umsetzen

### EYT-5 – Ressourcen und Fähigkeiten

- EYT-22 – Fähigkeiten für die Einsatzplanung verwalten
- EYT-23 – Geräte und Fahrzeuge planen und ihren Zustand melden

### EYT-6 – Arbeitszeit

- EYT-24 – Arbeitszeit aus geplantem Einsatz starten und stoppen
- EYT-25 – Arbeitszeiten freigeben und nachvollziehbar korrigieren

### EYT-7 – Wetter

- EYT-26 – Wetter-, Ozon- und DWD-Warnungsadapter mit zentralem Cache implementieren
- EYT-27 – Baustellenwetter und amtliche Warnungen in der Einsatzansicht anzeigen

### EYT-8 – Erweiterter Releaseumfang

- EYT-28 – Installierbare PWA mit lesendem Offline-Zugriff bereitstellen
- EYT-29 – Sprachnotizen lokal transkribieren und vor Speicherung bestätigen
- EYT-30 – Anfahrtszeit aus privatem Startpunkt anzeigen
- EYT-31 – PDF-/Druckexport und begrenzten CSV-Import bereitstellen

### EYT-9 – Qualität und Betrieb

- EYT-32 – CI-, Test-, Security- und Accessibility-Gates aufbauen
- EYT-33 – Aufbewahrung, Löschung, Backup und Restore festlegen
- EYT-34 – Pilotmetriken erheben und Pilot durchführen
- EYT-35 – Monitoring, Runbooks und Rollback für den Betrieb vorbereiten

### EYT-10 – Post-MVP-Planungsökonomie

- EYT-36 – Individuelle Netto-Kosten- und Verleihsätze mit Gültigkeit verwalten
- EYT-37 – Geplante und bestätigte interne Aufwände auswerten
- EYT-38 – Erlöse aus Maschinenverleih erfassen und auswerten
- EYT-39 – Post-MVP-Wirtschaftsdaten durch Feature Gate, Rechte und Audit schützen

## Grobe Priorisierung

### P0 / zuerst

- EYT-11 bis EYT-18
- EYT-19 bis EYT-21
- EYT-26 und EYT-27
- EYT-32, EYT-33 und EYT-35 als querschnittliche Release-Gates

### P1 / anschließend

- EYT-22 bis EYT-25
- EYT-28 bis EYT-31
- EYT-34

### Post-MVP

- EYT-36 bis EYT-39

## Nächste Refinement-Schritte

1. Architektur-ADRs aus EYT-13 abschließen.
2. Clickdummy-Szenarien und Testpersonen für EYT-11 festlegen.
3. MVP-Stories in vertikale Slices und Subtasks zerlegen.
4. Abhängigkeiten und Blocker in Jira verknüpfen.
5. Akzeptanzkriterien mit der kanonischen Traceability abgleichen.
6. Story Points oder andere Schätzmethode festlegen.
7. Sprintziel und ersten Sprint zusammenstellen.
8. E-Mail- und Wetterprovider entscheiden.
9. Retention rechtlich prüfen.
10. Post-MVP-Tickets aus dem MVP-Sprint ausschließen.
