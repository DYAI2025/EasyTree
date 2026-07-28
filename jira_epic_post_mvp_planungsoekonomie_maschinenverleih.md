# Jira Epic — Post-MVP Planungsökonomie und Maschinenverleih

## Epic-Ziel

Administrator und Geschäftsführung erhalten nach dem MVP eine interne, nachvollziehbare Übersicht über geplante Kosten, Ist-Kosten auf Basis freigegebener operativer Daten und Netto-Erlöse aus Maschinenverleih. Das Feature ist kein Lohn-, Rechnungs-, Steuer- oder Buchhaltungssystem.

## Scope

- Individuelle Netto-Stunden-/Tagessätze je Mitarbeiter, freiem Mitarbeiter/Subunternehmer und Ressource.
- Zusätzlicher individueller Netto-Mieterlössatz je vermietbarer Maschine.
- Gültigkeitszeiträume und unveränderliche Historie.
- Plan-Kosten aus Einsatz-/Reservierungsdauer.
- Ist-Kosten aus freigegebenen Zeiten und bestätigter Ressourcennutzung.
- Netto-Erlöse ausschließlich aus bestätigtem Maschinenverleih.
- Auswertung nach Person, Ressource, Baustelle, Tag, Woche und Zeitraum.
- Zugriff zunächst nur Administrator und Geschäftsführung.
- Audit, Exportkontrolle, Feature Flag und Rollback.

## Nicht im Scope

- Mitarbeiterzugriff auf wirtschaftliche Werte.
- Standardraten nach Rolle oder Ressourcentyp.
- Lohn-/Gehaltsberechnung.
- Rechnungen, Umsatzsteuer, Brutto, Zahlungen, Forderungen oder Buchungssätze.
- Andere Erlösarten als Maschinenverleih.
- Ersatz für Buchhaltung, Payroll oder Faktura.

## Vorgeschlagene Stories

### ECON-1 — Berechtigungen und Feature Gate
Nur Administrator/Geschäftsführung; serverseitige atomare Rechte; Feature im MVP deaktiviert.

### ECON-2 — Zeitlich gültige individuelle Sätze
Netto EUR, Stunde/Tag, gültig ab/bis, Versionierung, Überlappungsschutz, Audit.

### ECON-3 — Plan-Kosten
Berechnung aus geplanten Einsätzen und Ressourcenreservierungen mit angewendeter Satzversion.

### ECON-4 — Ist-Kosten
Berechnung nur aus freigegebenen Arbeitszeiten und bestätigter Ressourcennutzung.

### ECON-5 — Maschinenverleih-Erlöse
Bestätigte Mietzeiträume, maschinenspezifischer Netto-Mieterlössatz, keine Faktura-/Steuerwirkung.

### ECON-6 — Berichte und Exporte
Plan/Ist/Erlös getrennt, Filter nach Person, Ressource, Baustelle, Tag, Woche und Zeitraum; Quellen- und Satzversionsnachweis.

### ECON-7 — Historie, Audit und Korrekturen
Rückdatierte Korrektur nur mit Berechtigung, Begründung, Auswirkungsvorschau und Audit.

### ECON-8 — Security, Tests und Rollback
Autorisierung, Vertraulichkeit, Berechnungs-/Rundungstests, keine Buchhaltungsnebenwirkungen, Feature-Flag-Rollback.

## Release-Gate

Das Epic darf erst in Umsetzung gehen, wenn MVP Phase 1-6 abgeschlossen oder ausdrücklich neu priorisiert sind und Management die Post-MVP-Phase separat freigibt.
