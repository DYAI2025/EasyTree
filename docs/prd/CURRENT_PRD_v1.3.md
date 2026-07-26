# Arboscus Teamplaner – Current PRD v1.3

**Datum:** 23.07.2026  
**Status:** Fachlich freigegeben  
**Produktion:** Nicht freigegeben

## 1. Produktziel

Der Arboscus Teamplaner ist eine mobile-first, installierbare Web-App für die visuelle Planung von Mitarbeitern, Baustellen, Tätigkeiten, Fähigkeiten, Abwesenheiten, Geräten, Fahrzeugen, Zustandsmeldungen und persönlichen Arbeitszeiten.

Zentrale Frage:

> Wer arbeitet wann, wo, mit wem, mit welcher Aufgabe, mit welchen Fähigkeiten und mit welchen Ressourcen?

Die Wochenansicht ist die wichtigste operative Ansicht. Ergänzend bestehen Monatsansicht und rollierende Vier-Wochen-Planung.

## 2. Rollen

### Mitarbeiter

- sieht eigene Einsätze und zugehörige Baustelleninformationen;
- sieht Teammitglieder nur für gemeinsamen Ort und Zeitraum;
- bestätigt eine veröffentlichte Woche oder lehnt einen Termin begründet ab;
- erfasst Abwesenheiten, Arbeitszeit und Zustandsmeldungen;
- sieht keine wirtschaftlichen Sätze oder Auswertungen.

### Administrator

- verwaltet Benutzer, Mitarbeiter, Rollen, atomare Berechtigungen und Stammdaten;
- plant und veröffentlicht;
- prüft beziehungsweise korrigiert Arbeitszeiten;
- verwaltet Ressourcen und Konfigurationen.

### Geschäftsführung

- besitzt die fachliche Entscheidungs- und Freigabeverantwortung;
- darf entsprechend der Berechtigungen planen, veröffentlichen, genehmigen, korrigieren und Ressourcen freigeben.

Jeder Benutzer besitzt genau eine Rolle. Rechte werden serverseitig geprüft und können später granular angepasst werden.

## 3. Kern-MVP

- Benutzerkonten, Einladungen, Passwort-Reset und widerrufbare Sitzungen;
- Mitarbeiter anlegen, bearbeiten, deaktivieren und archivieren;
- Rollen und atomare Berechtigungen;
- Wochen-, Monats- und Vier-Wochen-Planung;
- Baustellen, Tätigkeiten, Briefing, Treffpunkt und interne Hinweise;
- freie Start- und Endzeiten sowie Ganz-/Halbtag-Vorlagen;
- Mitarbeiter verschieben, tauschen und innerhalb eines Tages mehreren Baustellen zuweisen;
- Entwurf, Veröffentlichung und Planversionen;
- Konfliktprüfung für Doppelbelegung, genehmigte Abwesenheit, aktivierte Kapazität und exklusive Ressourcen;
- Wochenbestätigung und terminbezogene Neubestätigung bei wesentlichen Änderungen;
- Ablehnung mit Kategorie und Pflichttext;
- In-App- und E-Mail-Benachrichtigung;
- Erinnerung und Eskalation nach konfigurierbar 24 Stunden ohne Reaktion;
- Urlaub, Krankheit und weitere Abwesenheiten;
- Fähigkeiten und sichtbare Fähigkeitslücken;
- eindeutige Geräte und Fahrzeuge, Reservierung, Verfügbarkeit und Zustandsmeldung;
- persönliche Arbeitszeit Start/Stop aus einem geplanten Einsatz;
- genau ein aktiver Timer, Erinnerung bei mehr als zehn Stunden;
- Zeitfreigabe und begründete administrative Korrektur unter Erhalt des Originals;
- Audit-Protokoll;
- baustellenbezogenes Wetter für heute und morgen.

## 4. Wetter

Wetter wird aus der sichtbaren Baustellenzuweisung abgeleitet. Es erfolgt kein Mitarbeitertracking, kein Geofencing und keine Hintergrundortung.

Pflichtwerte:

- Wetterzustand;
- Temperatur;
- relative Luftfeuchtigkeit;
- Niederschlagswahrscheinlichkeit;
- Niederschlagsmenge;
- Windgeschwindigkeit;
- maximale Böen;
- Ozonprognose;
- amtlicher Warnstatus.

Darstellung für heute und Folgetag:

- Morgen;
- Vormittag;
- Mittag;
- Nachmittag;
- Abend;
- Nacht.

Direkte und regionale Warnungen müssen unterscheidbar sein. Gewitter-, Sturm- und Unwetterwarnungen werden auffällig, aber nicht ausschließlich über Farbe dargestellt. Im MVP ist Wetter informativ und löst keine automatische Absage, Veröffentlichungsblockade oder Arbeitsstopp-Anweisung aus.

Empfohlene Integration:

- Prognose und Ozon über einen austauschbaren Wetteradapter;
- amtliche Warnungen über DWD-CAP/Open Data;
- zentraler Cache je Baustelle statt Abruf je Mitarbeiter;
- sichtbarer Aktualisierungszeitpunkt und klare Kennzeichnung veralteter Daten.

## 5. Erweiterter Bestandteil des ersten Releases

Diese Funktionen dürfen den Planungskern nicht blockieren:

- installierbare PWA;
- lesender Offline-Zugriff auf bereits geladene eigene Einsätze;
- Profilbilder und administrativer Avatar-Pool;
- gespeicherte Filter;
- PDF- und Druckexport unter Beachtung der Berechtigungen;
- Sprachnotizen mit überprüfbarer Transkription, vorzugsweise lokal über Whisper;
- geschätzte Anfahrtszeit aus privatem Startpunkt;
- begrenzter CSV-Import mit Vorschau, Fehlerliste und Bestätigung.

## 6. Post-MVP: Planungsökonomie und Maschinenverleih

Das Modul wird dokumentiert und in Jira vorbereitet, ist aber weder Teil der MVP-Implementierung noch der MVP-Abnahme.

Verbindliche Regeln:

- Zugriff zunächst nur für Administrator und Geschäftsführung;
- Mitarbeiter sehen keine eigenen oder fremden Sätze;
- spätere Öffnung nur über atomare Berechtigungen;
- individuelle Netto-Stunden- oder Tagessätze je Mitarbeiter, freiem Mitarbeiter, Gerät, Maschine oder Fahrzeug;
- keine Standardsätze nach Rolle oder Ressourcentyp;
- jeder Satz besitzt `gültig ab` und optional `gültig bis`;
- Änderungen erzeugen neue Satzversionen;
- historische Auswertungen behalten die angewendete Satzversion;
- Planwerte basieren auf geplanten Einsatzzeiten und Reservierungen;
- bestätigte Werte basieren auf freigegebenen Arbeitszeiten und bestätigter Ressourcennutzung;
- Erlöse werden ausschließlich für bestätigten Maschinenverleih betrachtet;
- Auswertung nach Einsatz, Baustelle, Tag, Woche und freiem Zeitraum.

Ausgeschlossen bleiben Lohnabrechnung, Rechnungen, Umsatzsteuerberechnung, Bruttobeträge, Zahlungen, Forderungen, Buchungssätze und andere Erlösarten.

## 7. Technische Leitentscheidungen

- kanonisches Repository: `DYAI2025/EasyTree` (bis 25.07.2026 `DYAI2025/Arborga`; siehe
  [ADR-002](../architecture/ADR-002-integration-canonical-repo.md));
- Datenbankplattform: Supabase Postgres;
- Supabase Auth als bevorzugte Authentifizierung;
- private Storage-Buckets mit Row Level Security;
- modulare TypeScript-Web/PWA und serverseitige API als Startarchitektur;
- separater Python-Worker nur für begründete Aufgaben wie lokale Transkription und geplante Jobs;
- externe Dienste hinter austauschbaren Adaptern;
- getrennte Entwicklungs-, Test- und Produktionsumgebungen;
- keine direkten Agenten-Schreibzugriffe auf operative Tabellen.

## 8. Datenschutz und Sicherheit

- serverseitige Autorisierung für jedes geschützte Objekt und Kommando;
- Row Level Security als zusätzliche Schutzschicht;
- minimale Verarbeitung von Abwesenheits-, Arbeitszeit-, Adress-, Foto- und Audiodaten;
- keine sensiblen Freitexte, Tokens oder Rohdaten in Logs;
- private Startpunkte sind nur für den jeweiligen Nutzer und technisch notwendige Verarbeitung sichtbar;
- Datei-Uploads benötigen Typ-, Größen-, Zugriffs- und gegebenenfalls Malware-Kontrollen;
- rechtlich geprüfte Aufbewahrungs- und Löschfristen bleiben Produktions-Gate;
- Datenbank- und Storage-Backups werden getrennt behandelt und wiederhergestellt getestet.

## 9. Umsetzungsphasen

1. Clickdummy und UX-Validierung
2. Foundation, Architektur und Access Control
3. Planungskern
4. Ressourcen und Arbeitszeit
5. Erweiterter Releaseumfang
6. Pilot und Production Hardening
7. separat freizugebendes Post-MVP-Modul Planungsökonomie/Maschinenverleih

## 10. MVP-Abnahme

Der MVP ist fachlich abnahmefähig, wenn unter anderem:

- mindestens zwölf aktive Nutzer und drei parallele Baustellen realistisch geplant werden können;
- unzulässige Doppelbelegungen und genehmigte Abwesenheiten Veröffentlichung blockieren;
- Mitarbeiter eigene Einsätze zuverlässig sehen, bestätigen oder begründet ablehnen können;
- relevante Baustelleninformationen, Ressourcen und Wetter verfügbar sind;
- Zeitbuchungen, Freigaben und Korrekturen nachvollziehbar bleiben;
- Rollen- und Datenzugriffe serverseitig abgesichert sind;
- zentrale mobile Nutzerreisen verständlich und zugänglich bedienbar sind;
- Backup/Restore, Security, Accessibility, Monitoring und Rollback vor Produktion nachgewiesen sind;
- das Post-MVP-Wirtschaftsmodul deaktiviert bleibt.

## 11. Offene Entscheidungen

- finaler Stack- und Hosting-ADR;
- Beibehaltung von `master` oder Umbenennung in `main`;
- transaktionaler E-Mail-Provider;
- verbindliche Wetterprovider-Kombination;
- zusätzliche Push-/E-Mail-Eskalation für neue Wetterwarnungen;
- rechtliche Freigabe der Aufbewahrungsmatrix;
- verbindliche Pilot-Baselines und Zielwerte.

## 12. Releaseentscheidung

- PRD: **FREIGEGEBEN**
- Clickdummy: **BEREIT**
- Implementierungsplanung: **BEREIT**
- Produktionsbetrieb: **NICHT FREIGEGEBEN**
