# EasyTree – Softwaredokumentation

# EasyTree – Softwaredokumentation

> **Dokumentstatus:** lebender Dokumentationsindex  
> **Stand:** 30.07.2026  
> **Repository:** `DYAI2025/EasyTree`  
> **Jira-Projekt:** `EYT`  
> **Release-Status:** keine Produktionsfreigabe

## Kanonische Dokumente

Unter dieser Seite liegen die fachlichen, architektonischen und gestalterischen Baselines:

1. **EasyTree – Produktvision und MVP-Zielbild**
2. **EasyTree – PRD v1.4: Planung, Feldkommunikation und interne Baustellenkosten**
3. **EasyTree – Traceability: erweiterter MVP, Jira und Delivery-Slices**
4. **EasyTree – Zwei-Client-Architektur und Admin-Kalender**
5. **EasyTree – Baustellenwetter und DWD-Integration**
6. **EasyTree – Basisdesign v2.0: Werkbank & Feld – ruhig verdichtet**
7. **EasyTree – Sprint 5: Modulare Tageskosten und Excel-Durchstich**

Jira ist die Source of Truth für Scope, Priorität, Status und Abhängigkeiten. GitHub ist die Source of Truth für Code, Pull Requests, CI und Laufzeitevidenz. Confluence beschreibt Vision, PRD, Architekturentscheidungen, Designvorgaben und Traceability.

## Produktziel

EasyTree verbindet verbindliche Wochenplanung, Baustelleninformationen, Fähigkeiten und Qualifikationen, Fahrzeuge und Geräte, persönliche Arbeitszeit sowie die strukturierte Kommunikation zwischen Baustelle und Zentrale.

Der am 28.07.2026 beschlossene modulare MVP-Schnitt umfasst zusätzlich:

- individuelle interne Stunden- und Tagessätze;
- Plan- und Ist-Kosten nach Baustelle, Tag, Woche und Zeitraum;
- Excel-Kostenexport;
- PDF-/Druckansicht der Arbeitswoche;
- Equipment-Bedarfsmeldung und zentrale Inbox;
- tagesbezogene Qualifikationsanforderungen;
- Erinnerungen bei vergessenem Arbeitszeitstart und ausstehendem Stopp.

Nicht Teil des MVP sind Lohnabrechnung, Rechnungsstellung, Steuer, Zahlung, Buchungssätze, DATEV, Einkauf, Lagerverwaltung, automatische Bestellung und Maschinenverleihserlöse.

## Designstatus

**EasyTree – Basisdesign v2.0: Werkbank & Feld – ruhig verdichtet** ist die verbindliche Designvorgabe.

Es vereinigt:

- die funktionale Struktur, Statuslogik, Feldtauglichkeit und Accessibility-Regeln aus „Werkbank & Feld“;
- die visuelle Ruhe, kompakte Topbar, Kartenrhythmik, Zeitansicht und den Inspector aus der korrigierten Penpot-Version;
- die verbindliche Zwei-Client-Grenze zwischen Desktop-Admin und Mobile-Mitarbeiter;
- die deterministische Wetterdarstellung;
- die rollen- und rechtegebundene Kosten- und Exportdarstellung.

Die alte fehlerhafte Penpot-Version ist keine gültige Designquelle. Die korrigierte Penpot-Datei ist eine editierbare Referenz, aber noch keine vollständige wiederverwendbare Komponentenbibliothek.

## PRD-Status

`docs/prd/CURRENT_PRD_v1.3.md` bleibt für Architektur, Rollen, Planung, Ressourcen, Arbeitszeit, Datenschutz und Release-Gates weitgehend gültig. Überholt ist die pauschale Einordnung der gesamten Planungsökonomie als Post-MVP.

**PRD v1.4 in Confluence ist die aktuelle fachliche Baseline.** Sie entscheidet:

1. Interne Kostensätze, Plan-/Ist-Kosten und Excel-Export gehören als begrenzter modularer Schnitt zum MVP.
2. Maschinenverleihserlöse bleiben Post-MVP.
3. PDF-/Druckexport und CSV-Import sind getrennte Liefergegenstände.
4. Qualifikationen besitzen Gültigkeit und können tages- und baustellenbezogen verlangt werden.
5. Start- und Stopp-Erinnerungen sind getrennte Funktionen und buchen nie automatisch.
6. Equipment-Bedarf und Defekt-/Zustandsmeldung bleiben fachlich getrennt.

## Jira-Struktur

### Produktgrundlage, UX und Design – EYT-1

- EYT-11 – zusammenhängenden Clickdummy validieren
- EYT-12 – Outdoor- und Accessibility-Regeln
- EYT-80 – Design-Tokens und UI-Primitives
- EYT-81 – Mitarbeiter-Mobile-Ansichten
- neue Basisdesign-, Komponenten- und Zustandsaufgaben gemäß Designbaseline v2.0

### Planung und Publish – EYT-3

- EYT-18 – Konfliktprüfung und Veröffentlichung
- EYT-50 – vertikaler Planungsdurchstich
- EYT-72 – Admin-Vollansicht
- EYT-92 – klickbare Wochenplanung
- EYT-98 – Qualifikationsprüfung beim Publish
- EYT-114 – vollständiger Admin-Kalender
- EYT-115 – versionierter Feiertagskalender

### Zwei Clients und Plattform – EYT-2

- EYT-113 – getrennte Admin- und Mitarbeiter-Shells mit gemeinsamen Verträgen

### Ressourcen und Qualifikationen – EYT-5

- EYT-22 – gültige Fähigkeiten und Qualifikationen
- EYT-23 – Geräte, Fahrzeuge und Zustandsmeldungen
- EYT-93 – Equipment-Bedarfsmeldung
- EYT-96 – zentrale Equipment-Inbox
- EYT-97 – tagesbezogene Qualifikationsanforderungen
- EYT-99 – bestätigte Ressourcennutzung

### Arbeitszeit – EYT-6

- EYT-24 – Arbeitszeit starten und stoppen
- EYT-25 – Freigabe und Korrektur
- EYT-100 – Start-Erinnerung
- EYT-101 – Stopp-Erinnerung

### Wetter – EYT-7

- EYT-26 – DWD-Adapter und Cache
- EYT-27 – Mitarbeiter-Wetterkarte
- EYT-111 – DWD-Quellenentscheidung
- EYT-112 – relevante Tagesbaustelle
- EYT-116 – Admin-Wetter im Planungskalender

### Kosten und Controlling – EYT-10

- EYT-36 – interne Stunden- und Tagessätze
- EYT-37 – Plan- und Ist-Kosten
- EYT-39 – Schutz der Wirtschaftsdaten
- EYT-94 – Excel-Kostenexport
- EYT-95 – Geld-, Rundungs- und Berechnungsvertrag
- EYT-108 – Mitarbeiter-Stundensatz
- EYT-109 – Tageskosten-Snapshot und UI
- EYT-110 – Excel-Export aus demselben Snapshot
- EYT-38 – Maschinenverleihserlöse, Post-MVP

## Delivery-Reihenfolge

1. Gemeinsame Design-Tokens, Zustandskomponenten und Client-Shells etablieren.
2. Planentwurf und Konfliktprüfung im Admin-Basisdesign abschließen.
3. Publish und Mitarbeiter-Lesesicht im Mobile-Basisdesign nachweisen.
4. Kostensätze, Plan-Kosten und Excel-Export gemäß Kosten-UX liefern.
5. Equipment-Bedarf und zentrale Inbox liefern.
6. Qualifikationsanforderungen und Publish-Blocker liefern.
7. Arbeitszeit und Erinnerungen liefern.
8. bestätigte Ressourcennutzung und Ist-Kosten liefern.
9. übergreifende E2E-, Security-, Accessibility- und Betriebsgates abschließen.

## Entscheidung

`PASS_WITH_ASSUMPTIONS` für Vision, PRD, Designbaseline und Backlogstruktur. `BLOCKED_RELEASE` für Produktion.
