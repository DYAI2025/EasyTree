# Arboscus Teamplaner - Finale Product Requirements Document

**Version:** 1.3 Final — Repository, Supabase, Wetter und Post-MVP-Planungsökonomie  
**Datum:** 23.07.2026  
**Status:** Fachlich freigegeben. MVP bereit fuer Clickdummy, ADRs und phasenweise Implementierung; Planungsökonomie/Maschinenverleih ist als Post-MVP-Backlog dokumentiert.  
**Produktionsfreigabe:** Noch nicht erteilt; technische Anbieter-, Datenschutz-, Aufbewahrungs-, Backup- und Security-Gates bleiben verpflichtend.

---

## 1. Executive Summary

Der Arboscus Teamplaner ist eine mobile-first, installierbare Web-App fuer die visuelle Planung von Mitarbeitern, Baustellen, Taetigkeiten, Faehigkeiten, Abwesenheiten, Geraeten, Fahrzeugen, Schadensmeldungen und persoenlichen Arbeitszeiten.

Das zentrale Produktproblem ist das Fehlen einer gemeinsamen, aktuellen und leicht verstaendlichen Quelle fuer die Frage:

> Wer arbeitet wann, wo, mit wem, mit welcher Aufgabe, mit welchen Faehigkeiten und mit welchen Ressourcen?

Die Arbeitswoche ist die wichtigste operative Ansicht. Die Planung kann zusaetzlich vier Wochen grob vorausplanen und eine Monatsansicht verwenden. Mitarbeiter sehen nur die fuer sie relevanten Einsaetze, Baustellen, Teammitglieder und Informationen. Administrator und Geschaeftsfuehrung erhalten entsprechend ihrer Berechtigungen eine erweiterte Planungssicht.

Das erste Release ist bewusst ein breiter MVP. Die Umsetzung wird deshalb in klar getrennte Inkremente aufgeteilt. Der Planungs- und Berechtigungskern darf nicht durch spaetere Komfortfunktionen blockiert werden.

## 2. Problemstellung

Die Einsatzplanung ist heute auf mehrere Medien verteilt: Hero, Excel, Messenger, Papierkalender und muendliche Absprachen. Dadurch entstehen unter anderem folgende Probleme:

- Mitarbeiter wissen teilweise erst kurzfristig, auf welcher Baustelle sie arbeiten.
- Aenderungen werden nicht fuer alle Betroffenen verlaesslich sichtbar.
- Urlaub, Krankheit und andere Ausfaelle werden nicht immer rechtzeitig in der Planung beruecksichtigt.
- Faehigkeiten und Maschinenberechtigungen sind nicht unmittelbar mit der Einsatzplanung verbunden.
- Ausgefallene oder beschaedigte Geraete beeinflussen mehrere Baustellen, werden aber nicht zentral durch alle betroffenen Planungen propagiert.
- Schadensinformationen koennen verloren gehen oder zu spaet dokumentiert werden.
- Arbeitszeiten muessen nachtraeglich aus dem Gedaechtnis rekonstruiert werden.
- Die bestehende Anwendung wird als teuer und fuer den konkreten Wochenplanungsprozess als nicht passend genug wahrgenommen.

## 3. Ziele und Nicht-Ziele

### 3.1 Ziele

- Eine verbindliche, zentrale Wochenplanung schaffen.
- Planungsaufwand und Rueckfragen reduzieren.
- Fehl- und Doppelbelegungen verhindern.
- Mitarbeiter sofort erkennen lassen, wo und wann sie arbeiten.
- Baustelleninformationen, Taetigkeiten, Team, Hinweise und Ressourcen an einer Stelle bereitstellen.
- Planungsaenderungen nachvollziehbar veroeffentlichen und bestaetigen lassen.
- Ablehnungen mit verpflichtender Begruendung erfassen.
- Urlaub, Krankheit und andere Abwesenheiten planungswirksam abbilden.
- Faehigkeitsluecken und Ressourcenprobleme frueh sichtbar machen.
- Schaeden schnell, strukturiert und beweisnah dokumentieren.
- Eine einfache persoenliche Arbeitszeitdokumentation mit Freigabe und Korrektur bereitstellen.
- Rollen, Berechtigungen, Faehigkeiten, Taetigkeiten und zentrale Stammdaten ohne Codeaenderung pflegbar machen.
- Eine fuer grobe Haende, Outdoor-Nutzung und wenig technikaffine Nutzer geeignete Bedienung schaffen.

### 3.2 Nicht-Ziele

- Im MVP keine Lohn-, Gehalts-, Honorar-, Rechnungs-, Umsatzsteuer-, Brutto-, Zahlungs- oder Buchungsberechnung.
- Eine spätere Post-MVP-Funktion darf ausschließlich interne Netto-Plan-/Ist-Kosten und Netto-Erlöse aus Maschinenverleih darstellen.
- Keine vollstaendige Buchhaltungssoftware und keine Übernahme der führenden Rolle von Lohnabrechnung, Faktura oder Finanzbuchhaltung.
- Kein kontinuierliches GPS-Tracking.
- Keine Bewegungsprofile und kein Geofencing.
- Keine automatische ortsbasierte Anwesenheitserkennung.
- Keine vollstaendige ERP-, Lager-, Wartungs- oder Beschaffungssoftware.
- Keine vollstaendige Nachbildung aller Hero-Funktionen.
- Keine vollstaendige historische Hero-Migration.
- Kein frei programmierbarer No-Code-Objekt- oder Workflow-Builder.

## 4. Stakeholder und Nutzer

### Geschaeftsfuehrung

- Fachlicher Sponsor und finale Entscheidungsinstanz.
- Darf planen, veroeffentlichen, Ablehnungen sehen, Abwesenheiten genehmigen, Arbeitszeiten freigeben oder korrigieren und Geraete formell freigeben.

### Administrator

- Verwaltet Nutzer, Rollen, Berechtigungen, Baustellen, Taetigkeiten, Faehigkeiten, Ressourcen und zentrale Konfigurationen.
- Darf planen und veroeffentlichen.
- Darf Arbeitszeiten korrigieren und Geraete freigeben.

### Mitarbeiter

- Sieht eigene Einsaetze und relevante Baustelleninformationen.
- Sieht Teammitglieder nur fuer gemeinsame Baustelle und gemeinsamen Zeitraum.
- Kann Woche bestaetigen oder einzelne Einsaetze begruendet ablehnen.
- Kann Urlaub und Abwesenheit erfassen.
- Kann Arbeitszeit starten und stoppen.
- Kann Schaeden melden.

### Freie Mitarbeiter

- Verwenden grundsaetzlich dieselbe operative Mitarbeiteransicht.
- Die Beschaeftigungsart ist Stammdatum, keine automatisch abweichende App-Rolle.

### Buchhaltung

- Kann bei Bedarf eine konfigurierbare Rolle erhalten.
- Das Produkt enthaelt trotzdem keine Lohn- oder Rechnungslogik.

## 5. Begriffe und Domaenenmodell

- **Baustelle:** Ort oder Auftrag mit Name, Adresse, Farbe, Taetigkeiten, Briefing, Team, Ressourcen und Zeitraum.
- **Einsatz/Zuweisung:** Verbindung zwischen Mitarbeiter, Baustelle, Beginn, Ende, Aufgabe, Teamrolle, Status und Bestaetigung.
- **Taetigkeit:** Art der Arbeit auf einer Baustelle; mindestens eine Taetigkeit ist vor Veroeffentlichung Pflicht.
- **Faehigkeit:** Praktische Kompetenz eines Mitarbeiters.
- **Qualifikation:** Formeller Nachweis oder Zertifikat; tiefe Zertifikatsverwaltung ist nicht Teil des Kern-MVP.
- **Rolle:** Genau ein Berechtigungspaket pro Nutzer.
- **Berechtigung:** Einzelnes serverseitig geprueftes Recht.
- **Veroeffentlichte Woche:** Freigegebener Plan, der fuer betroffene Mitarbeiter sichtbar wird und gesammelt bestaetigt werden muss.
- **Wesentliche Aenderung:** Aenderung an Zeit, Baustelle oder erforderlicher Anwesenheit; nur der betroffene Termin muss erneut bestaetigt werden.
- **Ressource:** Eindeutig identifizierbares Geraet oder Fahrzeug.
- **Schadensmeldung:** Strukturierter Datensatz zu Schaden, Hergang, Schwere und Nutzbarkeit.
- **Geschuetzter Kernstatus:** Technisch notwendiger, nicht loeschbarer Status mit fester fachlicher Bedeutung.
- **Audit-Eintrag:** Nicht regulaer veraenderbarer Nachweis einer relevanten Aenderung.

## 6. Verbleibende offene Punkte

Das bestehende PRD bleibt die fachliche Quelle der Wahrheit. Folgende Entscheidungen sind jetzt verbindlich geklärt:

- Kanonisches Implementierungsrepository: `https://github.com/DYAI2025/Arborga.git`.
- Datenbankplattform: Supabase; Zielregion Central EU/Frankfurt.
- Wetter ist nur für Nutzer mit sichtbarer Baustellenzuweisung verfügbar. Es wird kein Mitarbeiterstandort verfolgt.
- Wetterfelder: Zustand, Temperatur, relative Luftfeuchtigkeit, Niederschlagswahrscheinlichkeit, Niederschlagsmenge, Windgeschwindigkeit, maximale Böen, Ozonprognose und amtlicher Warnstatus.
- Darstellung: heute und Folgetag als kompletter Tagesverlauf in Zeitabschnitten; die Einsatzzeit wird hervorgehoben.
- Amtliche Warnungen, insbesondere Gewitter und starke Böen, werden prominent mit offizieller DWD-Stufe dargestellt.
- Wetter bleibt im MVP informativ und löst keine automatische Absage, Veröffentlichungsblockade oder verbindliche Arbeitsstopp-Anweisung aus.

Noch offen beziehungsweise zu bestätigen sind:

1. Empfohlener Stack und Deployment: modulare TypeScript-Web/PWA, serverseitige API/BFF, Supabase Frankfurt und separater Python-Worker auf deutschem Hosting.
2. Soll der derzeitige Default-Branch `master` vor Implementierungsbeginn in `main` umbenannt werden?
3. Welches transaktionale E-Mail-System wird angebunden; vorhandener Arboscus-Dienst oder vorläufig Brevo?
4. Bestätigung der Wetterarchitektur: OpenWeather für Prognose/Ozon plus DWD-CAP für amtliche Warnungen.
5. Sollen neue oder eskalierte Warnungen zusätzlich Browser-Push und E-Mail auslösen und eine Gesehen-Markierung verlangen?
6. Rechtliche Freigabe der Aufbewahrungsmatrix sowie fachliche Freigabe der Pilot-Zielwerte.

## 7. Produktumfang

### Kern-MVP

- Benutzerkonten, Einladungen, Passwort-Reset, widerrufbare Sitzungen.
- Startrollen Mitarbeiter, Administrator und Geschaeftsfuehrung.
- Genau eine Rolle pro Nutzer.
- Konfigurierbare atomare Berechtigungen.
- Wochen- und Monatskalender.
- Rollierende Vier-Wochen-Planung.
- Baustellen und Mitarbeiterzuweisungen mit Start- und Endzeit.
- Ganztags- und Halbtags-Schnellauswahl.
- Verschieben, Tauschen, Drag-and-drop und sichtbare Auswahlkarten.
- Entwurf, Veroeffentlichung und Planversionen.
- Wochenbestaetigung und terminbezogene Neubestaetigung.
- Begruendete Ablehnung.
- E-Mail- und In-App-Benachrichtigungen.
- Urlaub, Krankheit und andere Abwesenheiten.
- Faehigkeiten und Faehigkeitsluecken.
- Geraete, Fahrzeuge, Reservierungen und Ausfaelle.
- Schadensmeldungen und Fotos.
- Arbeitszeit Start/Stop, Freigabe und administrative Korrektur.
- Audit-Protokoll.
- Baustellenbezogenes Wetter fuer heute und den Folgetag mit sichtbarer Aktualitaet.

### Erweiterter Bestandteil desselben ersten Releases

- Installierbare PWA.
- Lesender Offline-Zugriff auf bereits geladene Einsaetze.
- Profilbilder und administrativer Avatar-Pool.
- Gespeicherte Kalenderfilter.
- PDF- und Druckexport.
- Sprachnotizen mit kontrollierbarer Transkription.
- Automatische Anfahrtszeit aus privatem Startpunkt.
- Begrenzter CSV-Import.

### Post-MVP / zukünftiges Jira-Epic: Planungsökonomie und Maschinenverleih

Diese Funktion gehört ausdrücklich **nicht zum MVP** und nicht zu den Implementierungsphasen 1 bis 6. Sie wird vollständig dokumentiert, damit sie später als eigenes Jira-Epic geplant werden kann.

- Individuelle Netto-Stunden- oder Tagessätze je Mitarbeiter, freiem Mitarbeiter/Subunternehmer und Gerät/Fahrzeug.
- Für vermietbare Maschinen zusätzlich individuelle Netto-Mieterlössätze je Stunde oder Tag.
- Keine Standardkostensätze nach Rolle oder Ressourcentyp erforderlich.
- Sätze besitzen `gültig ab` und optional `gültig bis`; Änderungen erzeugen neue Versionen und überschreiben keine Historie.
- Geplante Kosten werden aus Einsatz- und Reservierungszeiten abgeleitet.
- Ist-Kosten werden ausschließlich aus freigegebenen Arbeitszeiten und bestätigter Ressourcennutzung abgeleitet.
- Erlöse werden ausschließlich für bestätigten Maschinenverleih erfasst. Andere Erlösarten bleiben außerhalb des Produkts.
- Zugriff zunächst ausschließlich für Administrator und Geschäftsführung; spätere Erweiterung nur über atomare Berechtigungen.
- Ausschließlich Netto-Beträge in EUR; keine Umsatzsteuer-, Brutto-, Rechnungs-, Zahlungs-, Lohn- oder Buchungslogik.
- Auswertung nach Person, Ressource, Baustelle, Tag, Woche und frei gewähltem Zeitraum sowie getrennt nach Plan-Kosten, Ist-Kosten und Maschinenverleih-Erlösen.

## 8. Zentrale Nutzerreisen

1. Mitarbeiter meldet sich an und sieht sofort den heutigen oder naechsten Einsatz.
2. Mitarbeiter oeffnet Wochenplan und Baustelle und sieht Ort, Navigation, Taetigkeiten, Aufgabe, Team, Ressourcen und Hinweise.
3. Mitarbeiter bestaetigt die Woche oder lehnt einen Termin mit Kategorie und Pflichttext ab.
4. Planer erstellt einen Wochenplan, erkennt Konflikte und veroeffentlicht ihn.
5. Planer aendert einen Termin; nur Betroffene erhalten eine neue Bestaetigungsanfrage.
6. Administrator erstellt oder bearbeitet eine Rolle und sieht Warnungen fuer sensible Rechte.
7. Mitarbeiter startet und stoppt die Arbeitszeit; berechtigte Rolle gibt sie frei oder korrigiert sie.
8. Mitarbeiter meldet einen Schaden mit Foto oder kontrollierter Sprachnotiz.
9. Mitarbeiter beantragt Urlaub; Administrator oder Geschaeftsfuehrung genehmigt.
10. Mitarbeiter liest bereits geladene Einsatzinformationen bei temporaer fehlender Verbindung.
11. Mitarbeiter oeffnet einen heutigen oder morgigen Einsatz und sieht das Wetter der Baustelle mit Aktualisierungszeitpunkt.

## 9. User Stories

- Als Mitarbeiter moechte ich meinen naechsten Einsatz sofort erkennen, damit ich nicht nachfragen muss.
- Als Planer moechte ich Mitarbeiter, Abwesenheiten, Faehigkeiten und Ressourcen gemeinsam sehen, damit ich realistische Teams bilde.
- Als Mitarbeiter moechte ich eine Woche gesammelt bestaetigen und spaeter nur geaenderte Termine erneut bestaetigen.
- Als Mitarbeiter moechte ich einen Einsatz mit einer Begruendung ablehnen koennen.
- Als Administrator moechte ich Rollen und Rechte ohne technische Konfigurationsdateien pflegen.
- Als Teammitglied moechte ich nur die fuer meinen Einsatz relevanten Kollegen und Abwesenheiten sehen.
- Als Planer moechte ich Doppelbelegungen, Urlaub und Ressourcenprobleme vor Veroeffentlichung erkennen.
- Als Mitarbeiter moechte ich Schaeden mit wenig Tipparbeit dokumentieren.
- Als Geschaeftsfuehrung moechte ich sicherheitskritische Geraetefreigaben kontrollieren und nachvollziehen.
- Als Mitarbeiter moechte ich Arbeitszeit mit einem grossen Start-/Stopp-Button erfassen.
- Als Geschaeftsfuehrung moechte ich Zeiten freigeben oder korrigieren, ohne den Originalwert zu verlieren.
- Als Mitarbeiter moechte ich eine Anfahrtszeit sehen, ohne meine private Startadresse fuer Kollegen offenzulegen.

## 10. Funktionale Anforderungen

### 10.1 Konten, Rollen und Sichtbarkeit

- **FR-001:** Administratoren koennen Konten einladen, aktivieren, deaktivieren und archivieren. Nutzer koennen Passwoerter setzen und zuruecksetzen. Sitzungen sind widerrufbar.
- **FR-002:** Jeder Nutzer besitzt genau eine Rolle. Startvorlagen sind Mitarbeiter, Administrator und Geschaeftsfuehrung.
- **FR-003:** Administratoren koennen Rollen anlegen, kopieren, bearbeiten, deaktivieren und atomare Berechtigungen auswaehlen.
- **FR-004:** Berechtigungen und Objekt-Sichtbarkeit werden serverseitig geprueft. Mitarbeiter sehen standardmaessig nur eigene Einsaetze, zugewiesene Baustellen und relevante Teammitglieder.
- **FR-005:** Kalender sind nach Baustelle, Tag, Woche, Mitarbeiter, Abwesenheit, Faehigkeit, Ressource, Schaden, Bestaetigungsstatus und laufender Zeit filterbar.
- **FR-006:** Nutzer koennen erlaubte Filterkombinationen persoenlich speichern.

### 10.2 Baustellen und Taetigkeiten

- **FR-007:** Baustellen koennen angelegt, bearbeitet, archiviert und farblich gekennzeichnet werden.
- **FR-008:** Vor Veroeffentlichung sind Baustellenname, Standort, mindestens ein Mitarbeiter und mindestens eine Taetigkeit Pflicht.
- **FR-009:** Taetigkeiten werden als direkt sichtbare Mehrfachauswahl-Checkboxen dargestellt. Die Beschreibung ist ueber ein Info-Element erreichbar.
- **FR-010:** Initialer Taetigkeitskatalog: Baumpflege, Baumkontrolle, Bodensanierung, Scha edlinge, Fassadenkletterei, Baumfaellungen, Baumsicherung, Diagnose, Sturmschaeden, Flaechenraeumung, Baubegleitung, Maschinenverleih.
- **FR-011:** Administratoren koennen Taetigkeiten ergaenzen oder deaktivieren; historische Baustellen behalten ihre gespeicherten Werte.
- **FR-012:** Eine reine Taetigkeitsaenderung informiert Betroffene, erfordert aber keine neue Anwesenheitsbestaetigung.
- **FR-013:** Administratoren verwalten operative Baustellennotizen; zugewiesene Mitarbeiter koennen sie lesen.

### 10.3 Planung, Konflikte und Veroeffentlichung

- **FR-014:** Einsaetze besitzen frei waehlbare Start- und Endzeiten sowie Ganztags- und Halbtagsvorlagen.
- **FR-015:** Ein Mitarbeiter kann an einem Tag nacheinander auf mehreren Baustellen eingeplant werden.
- **FR-016:** Mitarbeiter koennen verschoben, getauscht, entfernt oder einem Team hinzugefuegt werden.
- **FR-017:** Entwuerfe sind nur fuer berechtigte Rollen sichtbar.
- **FR-018:** Nur Administrator und Geschaeftsfuehrung duerfen veroeffentlichen.
- **FR-019:** Die Erstveroeffentlichung wird als gesamte Woche bestaetigt.
- **FR-020:** Spaetere wesentliche Aenderungen erfordern nur fuer den geaenderten Termin eine neue Bestaetigung.
- **FR-021:** Jeder Mitarbeiter kann einen Termin ablehnen. Ablehnungsgrund-Kategorie und Freitext sind Pflicht.
- **FR-022:** Administrator und Geschaeftsfuehrung erhalten Ablehnung und Begruendung.
- **FR-023:** Kurzfristige Einsaetze unter 24 Stunden duerfen veroeffentlicht werden und werden als dringend markiert.
- **FR-024:** Nicht beantwortete Einsaetze erzeugen nach konfigurierbarer Frist, initial 24 Stunden, Erinnerung und Eskalation.
- **FR-025:** Blockierend sind mindestens Doppelbelegung, genehmigte Abwesenheit, aktivierte Kapazitaetsueberschreitung, Ressourcen-Doppelreservierung und gesperrte Ressource.
- **FR-026:** Organisatorische Probleme koennen als Warnung modelliert werden. Berechtigte Uebersteuerungen benoetigen eine Begruendung und Audit-Eintrag.

### 10.4 Mitarbeiter, Faehigkeiten und Abwesenheit

- **FR-027:** Mitarbeiterprofile enthalten Name, Avatar/Foto, Kontakt, Beschaeftigungsdaten, Faehigkeiten, optionale Wochenkapazitaet und Status.
- **FR-028:** Faehigkeiten sind administrativ konfigurierbar und Mitarbeitern sowie Baustellenanforderungen zuweisbar.
- **FR-029:** Faehigkeitsluecken im geplanten Team werden sichtbar.
- **FR-030:** Mitarbeiter und Planung koennen Abwesenheiten erfassen.
- **FR-031:** Urlaub startet als Antrag und wird von Administrator oder Geschaeftsfuehrung genehmigt oder abgelehnt.
- **FR-032:** Krankheit erzeugt sofortige Nichtverfuegbarkeit.
- **FR-033:** Teammitglieder sehen nur die fuer den gemeinsamen Einsatzzeitraum relevante Nichtverfuegbarkeit, keine Diagnosen.

### 10.5 Ressourcen und Schaeden

- **FR-034:** Geraete und Fahrzeuge werden einzeln und eindeutig identifizierbar erfasst.
- **FR-035:** Ressourcen besitzen konfigurierbare Eigenschaften und Statuswerte innerhalb geschuetzter Kernlogik.
- **FR-036:** Ressourcen werden zeitbezogen Baustellen zugeordnet.
- **FR-037:** Eine Doppelreservierung blockiert die Veroeffentlichung.
- **FR-038:** Ein Ausfall wird zentral gespeichert und auf allen betroffenen Baustellen sichtbar.
- **FR-039:** Jeder angemeldete Mitarbeiter darf einen Schaden melden.
- **FR-040:** Eine Schadensmeldung enthaelt Ressource/Fahrzeug, Baustelle, meldende Person, Zeitpunkt, Beschreibung, Hergang, Typ, Bereich, Schweregrad und Nutzbarkeit.
- **FR-041:** Bei schwerem oder sicherheitskritischem Schaden ist mindestens ein Foto Pflicht.
- **FR-042:** Nur Administrator und Geschaeftsfuehrung duerfen eine gesperrte Ressource formell freigeben.
- **FR-043:** Freigabe erfordert Begruendung und Audit-Eintrag.
- **FR-044:** Sprachnotizen koennen transkribiert werden; der Nutzer muss den Text vor Absenden pruefen und bestaetigen.

### 10.6 Arbeitszeit

- **FR-045:** Arbeitszeit kann nur aus einem eingeplanten Einsatz gestartet werden.
- **FR-046:** Es darf nur ein Timer gleichzeitig laufen.
- **FR-047:** Nach zehn Stunden erhaelt der Mitarbeiter E-Mail und In-App-Rueckfrage. Der Timer laeuft weiter und wird markiert.
- **FR-048:** Pausen werden im ersten MVP nicht separat erfasst.
- **FR-049:** Nach Stoppen befindet sich die Buchung im Status Zur Freigabe.
- **FR-050:** Administrator oder Geschaeftsfuehrung kann freigeben, mit Begruendung korrigieren oder zur Klaerung markieren.
- **FR-051:** Originalwert, Korrektur, Person, Zeitpunkt und Begruendung bleiben nachvollziehbar.
- **FR-052:** Mitarbeiter werden ueber Korrektur oder Beanstandung informiert.
- **FR-053:** Im MVP erzeugen Zeitdaten keinerlei Geld- oder Abrechnungswerte. Die Post-MVP-Anforderungen zur Planungsökonomie werden nur in einer separat freigegebenen Phase umgesetzt.

### 10.7 Benachrichtigung, Export und Offline

- **FR-054:** Relevante Ereignisse erzeugen E-Mail und In-App-Meldung.
- **FR-055:** Antworten und Bestaetigungen erfolgen innerhalb der App, nicht direkt in der E-Mail.
- **FR-056:** Nur Administrator und Geschaeftsfuehrung koennen globale Nachrichten senden.
- **FR-057:** Berechtigte Nutzer koennen einen sichtbarkeitskonformen PDF- oder Druckexport erzeugen.
- **FR-058:** Bereits geladene Einsaetze, Baustelleninformationen und benoetigte Kontakte sind offline lesbar.
- **FR-059:** Offline-Daten zeigen Synchronisationszeitpunkt und sind nicht bearbeitbar.
- **FR-060:** Mitarbeiter koennen eine private Startadresse fuer Anfahrtszeit speichern; andere Mitarbeiter sehen diese Adresse nicht.
- **FR-061:** CSV-Import ist auf aktive Mitarbeiter, Faehigkeiten, Ressourcen und offene Baustellen begrenzt und besitzt eine Vorschau.

### 10.8 Wetter und Mitarbeiterlebenszyklus

- **Kanonisch FR-043 — Sichtbarkeit:** Wetter wird nur für heute oder morgen zugewiesene, für den Nutzer sichtbare Baustellen angezeigt. Die Berechtigung ergibt sich aus Einsatz und Baustelle. Es gibt kein kontinuierliches GPS- oder Hintergrundtracking von Mitarbeitern.
- **Kanonisch FR-044 — Mitarbeiterlebenszyklus:** Berechtigte Nutzer können Mitarbeiter anlegen, bearbeiten, deaktivieren und archivieren. Historische Einsätze, Arbeitszeiten, Freigaben, Schadensmeldungen und Audit-Bezüge bleiben erhalten.
- **Kanonisch FR-045 — Wetterwerte:** Zustand, Temperatur, relative Luftfeuchtigkeit, Niederschlagswahrscheinlichkeit, erwartete Niederschlagsmenge, Windgeschwindigkeit, maximale Böen, Ozonprognose und amtlicher Warnstatus werden mit Einheit, Quelle und Aktualisierungszeit angezeigt.
- **Kanonisch FR-046 — Tagesabschnitte:** Heute und Folgetag werden als vollständiger Tagesverlauf dargestellt. Empfohlene Standardabschnitte: Morgen 05–08 Uhr, Vormittag 08–11 Uhr, Mittag 11–14 Uhr, Nachmittag 14–18 Uhr, Abend 18–22 Uhr und Nacht 22–05 Uhr. Einsatzrelevante Abschnitte werden hervorgehoben.
- **Kanonisch FR-047 — Amtliche Warnungen:** DWD-Warnungen für Gemeinde, Kreis oder direkt überlappende Warnfläche werden mit Ereignis, Stufe, Gültigkeit, Quelle und Aktualität prominent angezeigt. DWD-Farben bleiben gelb, orange, rot und violett; Farbe wird immer durch Text, Stufe und Icon ergänzt. Nahe Warnungen werden ausdrücklich als regional beziehungsweise in der Nähe gekennzeichnet.
- **Kanonisch FR-048 — Informative Wirkung:** Im MVP darf Wetter keine Einsätze automatisch absagen, sperren, verschieben oder einen verbindlichen Arbeitsstopp auslösen. Die organisatorische und sicherheitsfachliche Entscheidung bleibt bei Arboscus.
- **Kanonisch FR-049 — Ozon:** Ozon wird als Prognose in µg/m³ gekennzeichnet. 120 µg/m³ ist als gesundheitlicher Zielwert, 180 µg/m³ als Informationsschwelle und 240 µg/m³ als Alarmschwelle zu benennen. Die App erzeugt keine medizinische Diagnose.
- **Aktualisierung:** Prognose und Luftqualität werden pro Baustelle gecacht, nicht pro Mitarbeiter. Empfohlen sind maximal dreistündliche Prognose- und sechsstündliche Ozonaktualisierung. Amtliche DWD-Warnungen werden zentral spätestens alle zehn Minuten geprüft; nach zwanzig Minuten ohne erfolgreichen Abruf gilt der Warnstand als veraltet.
- **Ausfall:** Die Einsatzansicht bleibt verfügbar. Der letzte erfolgreiche Stand wird mit Zeitstempel als veraltet oder die Wetterfunktion als nicht verfügbar angezeigt.

### 10.9 Post-MVP: Planungsökonomie und Maschinenverleih

- **FR-062:** Die Funktion ist für Jira dokumentiert, aber im MVP deaktiviert und nicht Bestandteil der MVP-Abnahme.
- **FR-063:** Nur Administrator und Geschäftsführung dürfen zunächst Sätze, Kosten, Erlöse, Berichte und Exporte sehen oder bearbeiten. Mitarbeiter sehen keinerlei wirtschaftliche Werte.
- **FR-064:** Jeder Mitarbeiter, freie Mitarbeiter/Subunternehmer und jede Ressource kann einen individuellen Netto-Stunden- oder Tagessatz mit Gültigkeitszeitraum besitzen. Vermietbare Maschinen können zusätzlich einen individuellen Netto-Mieterlössatz besitzen.
- **FR-065:** Neue Sätze werden versioniert. Historische Kalkulationen behalten die damals wirksame Satzversion; rückdatierte Korrekturen benötigen Berechtigung, Begründung, Vorschau und Audit.
- **FR-066:** Plan-Kosten entstehen aus geplanten Einsatz- und Reservierungszeiten.
- **FR-067:** Ist-Kosten entstehen nur aus freigegebenen Arbeitszeiten und bestätigter Ressourcennutzung.
- **FR-068:** Netto-Erlöse werden ausschließlich aus bestätigten Maschinenverleih-Zeiträumen berechnet. Andere Erlösarten bleiben ausgeschlossen.
- **FR-069:** Berichte trennen Plan-Kosten, Ist-Kosten und Maschinenverleih-Erlöse und können nach Person, Ressource, Baustelle, Tag, Woche und Zeitraum ausgewertet werden.
- **FR-070:** Es werden keine Umsatzsteuer, Bruttobeträge, Löhne, Rechnungen, Zahlungen, Forderungen oder Buchungssätze erzeugt.

## 11. Nicht-funktionale Anforderungen

- Mobile-first und installierbare PWA.
- Grosse Touch-Ziele, geeignet fuer grobe Haende und Baustellensituation.
- Heutiger oder naechster Einsatz muss ohne Suche sichtbar sein.
- Pro Ansicht eine klare primaere Aktion.
- Keine unnoetigen Dropdown-Menues; sichtbare Karten, Chips, Checkboxen oder Segmentschalter.
- Farbe niemals als alleiniger Informationstraeger.
- Baustellenfarbe wird durch Name, Kuerzel oder Icon ergaenzt.
- Aktuelle Safari- und Chrome-Versionen auf iOS/Android sowie Chrome, Edge und Safari am Desktop.
- Transaktionale Konsistenz fuer Veroeffentlichung, Bestaetigung, Timer und Ressourcenstatus.
- Idempotente wiederholbare Befehle.
- Serverseitige Autorisierung.
- Sichere Sitzungen und Datei-Uploads.
- Taegliche Backups und getestete Wiederherstellung.
- Keine technische Begrenzung auf die heutige Mitarbeiter- oder Baustellenzahl.
- Wetterdaten zeigen Aktualisierungszeitpunkt und fallen bei Anbieterfehler klar auf Cache oder Nicht-verfuegbar zurueck.
- Der Pilot testet mindestens zwoelf aktive Mitarbeiter und drei parallele Baustellen; dies sind keine technischen Maximalwerte.

## 12. Datenmodell

Kernentitaeten:

1. UserAccount
2. Role
3. Permission
4. Employee
5. Worksite
6. ActivityType
7. Assignment
8. AssignmentConfirmation
9. Absence
10. Skill
11. Resource
12. ResourceReservation
13. DamageReport
14. Attachment
15. TimeEntry
16. TimeApproval
17. Notification
18. AuditRecord
19. SavedFilter
20. PrivateRouteOrigin
21. WeatherSnapshot
22. OfficialWeatherWarning
23. EconomicRateVersion (Post-MVP)
24. PlannedEconomicSnapshot (Post-MVP, abgeleitet)
25. ActualCostRecord (Post-MVP, abgeleitet)
26. MachineRentalRecord (Post-MVP)

Die vollstaendige Feld- und Beziehungsspezifikation befindet sich in `prd_report.json` und wird vor Implementierung in ein versioniertes Schema beziehungsweise ER-Modell ueberfuehrt.

## 13. API- und Schnittstellenanforderungen

Erforderliche API-Bereiche:

- Authentifizierung und Sitzungen.
- Nutzer, Rollen und Berechtigungen.
- Baustellen, Taetigkeiten, Notizen und Anhaenge.
- Einsaetze, Kalender, Konfliktpruefung und Veroeffentlichung.
- Bestaetigung, Ablehnung, Erinnerung und Eskalation.
- Abwesenheit und Urlaubsfreigabe.
- Faehigkeiten und Lueckenpruefung.
- Ressourcen, Reservierungen, Sperrung und Freigabe.
- Schadensmeldungen.
- Arbeitszeit und Freigabe.
- In-App-Benachrichtigungen und E-Mail-Zustellung.
- Geschuetzte Datei-Uploads und Downloads.
- Routing-Adapter.
- Transkriptions-Adapter.
- PDF-/Druckexport.
- CSV-Import.
- Prognose- und Luftqualitätsadapter für Baustellenwetter und Ozon.
- DWD-CAP-Adapter für amtliche Wetter- und Unwetterwarnungen.
- Post-MVP: Rate-Administration, Plan-/Ist-Kostenberichte und Maschinenverleih-Erlös-Schnittstellen ohne Buchhaltungsnebenwirkungen.

API-Vertraege muessen vor paralleler Frontend-/Backend-Implementierung als OpenAPI oder gleichwertiger Vertrag versioniert werden.

## 14. Architekturvorgaben

- Domaenenlogik darf nicht von UI, HTTP, Datenbanktreiber oder Anbieter-SDK abhaengen.
- Module: Identity/Access, Workforce, Worksites, Planning, Resources/Damage, Time, Notifications, Files, Reporting.
- Externe Dienste liegen hinter austauschbaren Ports/Adaptern.
- Autorisierung erfolgt in jedem geschuetzten Query und Command serverseitig.
- Veroeffentlichung, Versionierung, Konfliktpruefung und Bestaetigungsanforderung werden konsistent transaktional beziehungsweise mit Reliable Outbox verarbeitet.
- Veroeffentlichen, Bestaetigen, Ablehnen, Timer Start/Stop und Notification Jobs muessen idempotent sein.
- Offline-Cache ist autorisiert, zeitlich begrenzt und read-only.
- Audit-Daten sind append-only fuer regulaere Workflows.
- Zusatzfelder duerfen Kernobjekte erweitern, aber keine beliebige Logik ausfuehren.
- Hintergrundjobs benoetigen Retry-Limit, Fehlerkanal, Monitoring und Stop-Bedingungen.
- Entwicklungs-, Test- und Produktionsumgebung sind getrennt.
- Zentrale Technologie- und Anbieterentscheidungen werden als ADR dokumentiert.
- Prognose-, Luftqualitäts- und DWD-Warnquellen liegen hinter getrennten austauschbaren Adaptern; ihr Ausfall darf die Einsatzansicht nicht blockieren.
- Wetter wird serverseitig pro Baustelle gecacht; mobile Clients besitzen keine Anbieter-Schlüssel.
- Kanonisches Repository ist `DYAI2025/Arborga`; der Default-Branch wird vor Codebeginn per ADR auf `main` umgestellt oder bewusst als `master` bestätigt.
- Supabase Postgres in Frankfurt ist die Datenbankbasis; Supabase Auth und private Storage-Buckets mit RLS sind die empfohlene Ergänzung.
- Datenbank- und Datei-Backups werden getrennt behandelt, weil Supabase-Datenbankbackups gelöschte Storage-Objekte nicht wiederherstellen.
- Post-MVP-Planungsökonomie bildet ein getrenntes Modul und konsumiert nur freigegebene Fakten aus Planung, Arbeitszeit und Ressourcennutzung. Historische Kalkulationen referenzieren unveränderliche Satzversionen.

## 15. Security, Datenschutz und Compliance-Grenzen

- Passwoerter werden mit geeignetem Passwort-Hashing gespeichert.
- Sitzungen sind befristet, widerrufbar und bei Deaktivierung ungueltig.
- Berechtigungen und Objekt-Sichtbarkeit werden serverseitig erzwungen.
- Sensible Berechtigungen erzeugen Warnung und Audit-Eintrag.
- Private Startadressen duerfen nicht in Teamansichten, Exporten oder regulaeren Logs erscheinen.
- Krankheitsdiagnosen werden nicht fuer Teammitglieder gespeichert oder dargestellt.
- Datei-Uploads werden nach Typ, Groesse, Zugriff und Schadcode-Risiko geprueft.
- Dateien erhalten keine ungeschuetzten oeffentlichen URLs.
- Loeschung wird bei historischen Daten durch Deaktivierung oder Archivierung ersetzt.
- Geraetefreigabe ist auf Administrator und Geschaeftsfuehrung beschraenkt.
- TLS und Verschluesselung ruhender Daten werden vorausgesetzt.
- Backups sind verschluesselt und zugriffsbeschraenkt.
- Anbieter-Datenfluesse werden vor Produktion dokumentiert und geprueft.
- Kein kontinuierliches Standorttracking.
- Keine Behauptung einer automatischen DSGVO-Konformitaet; rechtliche Pruefung erfolgt separat.

## 16. Sustainability und GreenOps

- Infrastruktur wird fuer einen kleinen Betrieb angemessen dimensioniert.
- Keine unnoetige Microservice- oder Cluster-Komplexitaet.
- Kalender-, Zeitraum-, Mitarbeiter-, Ressourcen- und Audit-Abfragen werden gezielt indexiert.
- Offline-Daten werden begrenzt und automatisch bereinigt.
- Bilder werden komprimiert; Audio und PDF unterliegen Aufbewahrungsregeln.
- Hintergrundjobs werden gebuendelt und besitzen begrenzte Wiederholungen.
- Nutzung und Kosten externer Anbieter werden beobachtet.

## 17. Kontextartefakte fuer Implementierung

Vor beziehungsweise waehrend Implementierung werden erstellt:

- `docs/prd/prd_report.md`
- `docs/prd/prd_report.json`
- ADRs fuer Stack, Hosting, Auth, Datenbank, Storage, E-Mail, Routing, Transkription, PDF, Monitoring und Retention.
- Maschinenlesbare Berechtigungsmatrix.
- Domaenenglossar und Status-/Uebergangsmodell.
- API-Vertraege.
- Deterministische Test-Fixtures.
- Repository-spezifische `AGENTS.md`.
- Scope- und Entscheidungslog.

## 18. Implementierungsphasen

### Phase 1 - Clickdummy und UX-Validierung

Mobile Startseite, Wochenplan, Baustellendetail, Bestaetigung/Ablehnung, Rollen-Editor, Timer und Schadensmeldung klickbar prototypisieren und mit realen Nutzern testen.

### Phase 2 - Foundation und Access Control

ADRs, Repository, CI, Umgebungen, Authentifizierung, Nutzer, Rollen, Berechtigungen, Audit und Designsystem.

### Phase 3 - Planungskern

Mitarbeiter, Faehigkeiten, Baustellen, Taetigkeiten, Abwesenheiten, Einsaetze, Konflikte, Entwurf/Veroeffentlichung, Bestaetigungen, Benachrichtigungen und Kalender.

### Phase 4 - Ressourcen und Arbeitszeit

Geraete, Fahrzeuge, Reservierungen, Ausfaelle, Schaeden, Dateien, Timer, Zeitfreigabe und Korrektur.

### Phase 5 - Erweiterter Releaseumfang

PWA, Offline-Cache, Filter, PDF, Profilbilder, Transkription, Anfahrtszeit und CSV-Import.

### Phase 6 - Pilot und Production Hardening

Pilot, Messung, Datenschutz-/Retention-Review, Restore-Test, Security-Test, Browser-/Accessibility-Test, Monitoring, Runbooks und Produktionsfreigabe.

### Phase 7 - Post-MVP Planungsökonomie und Maschinenverleih

Erst nach separater Freigabe: Berechtigungen, individuelle zeitlich gültige Netto-Sätze, Plan-/Ist-Kosten, bestätigte Maschinenverleih-Erlöse, Berichte, Audit, Migration, Feature Flag und Rollback.

## 19. Atomare Aufgaben

Die MVP-Implementierung ist in mindestens 31 Tasks zerlegt; zusätzlich sind die Post-MVP-Tasks `TASK-032` bis `TASK-036` für Planungsökonomie und Maschinenverleih dokumentiert; Version 1.3 ergänzt Repository-/Plattform-ADR, Wetter-/DWD-Integration, Pilotmessung, Retention sowie das Post-MVP-Epic Planungsökonomie/Maschinenverleih. Die vollständige atomare Taskliste mit IDs `TASK-001` bis `TASK-036`, Abhaengigkeiten, Testzuordnung, Risiken und Stop-Bedingungen befindet sich im kanonischen `prd_report.md`, `prd_report.json` und `traceability_matrix.csv`.

Zentrale Reihenfolge:

1. Clickdummy erstellen und testen.
2. ADRs und Repository-Validierung definieren.
3. Foundation und Authentifizierung aufbauen.
4. Rollen/Berechtigungen und Audit implementieren.
5. Planungskern implementieren.
6. Ressourcen und Arbeitszeit implementieren.
7. Erweiterte Funktionen implementieren.
8. Pilot, Security, Restore und Release-Gates durchfuehren.

## 20. Akzeptanzkriterien

Jede funktionale Anforderung besitzt ein zugeordnetes Given-When-Then-Kriterium (`AC-001` bis `AC-042`) im kanonischen PRD.

Beispiele:

- **Baustelle unvollstaendig:** Fehlen Name, Standort, Mitarbeiter oder Taetigkeit, wird die Veroeffentlichung mit Feldhinweisen blockiert.
- **Woche bestaetigen:** Eine Bestaetigung akzeptiert alle Termine der veroeffentlichten Woche; spaetere wesentliche Aenderung oeffnet nur den betroffenen Termin.
- **Ablehnung:** Ohne Kategorie und Freitext kann eine Ablehnung nicht abgesendet werden.
- **Doppelbelegung:** Ein zeitgleich doppelt eingeplanter Mitarbeiter blockiert die Veroeffentlichung.
- **Urlaub:** Genehmigter Urlaub blockiert ueberlappende Planung.
- **Geraeteausfall:** Sperrung einer Ressource markiert alle betroffenen Reservierungen.
- **Schwerer Schaden:** Ohne Foto kann eine schwere oder sicherheitskritische Meldung nicht abgesendet werden.
- **Geraetefreigabe:** Mitarbeiter werden serverseitig abgewiesen; nur Administrator und Geschaeftsfuehrung koennen mit Begruendung freigeben.
- **Timer:** Ein zweiter paralleler Timer wird abgewiesen.
- **Zeitkorrektur:** Originalwert bleibt erhalten und Mitarbeiter wird informiert.
- **Export:** Enthalten sind nur Daten, die der exportierende Nutzer in der App sehen darf.
- **Offline:** Geladene Daten bleiben lesbar, sind als eventuell veraltet markiert und nicht editierbar.

## 21. Teststrategie

- Unit-Tests fuer Statusuebergaenge, Konflikte, Kapazitaet, Sichtbarkeit und Timer.
- Autorisierungs-Integrationstests fuer jede sensible Berechtigung.
- API-Vertragstests fuer Validierung, Idempotenz, Fehler und Parallelitaet.
- End-to-End-Tests fuer alle Nutzerreisen.
- Konflikttests fuer Doppelbelegung, Urlaub, Kapazitaet, Ressourcen und kurzfristige Aenderungen.
- Benachrichtigungstests fuer Outbox, E-Mail, In-App, Retry und Eskalation.
- Datei-Security-Tests.
- Arbeitszeit- und Korrekturtests.
- Offline- und Cache-Tests.
- Accessibility- und Outdoor-Usability-Tests.
- Browsermatrix-Tests.
- Performance-Tests.
- Backup-Restore- und Environment-Isolation-Test.
- Security-Tests fuer Auth, Authz, Upload, Injection, Rate Limits und Log-Redaction.
- Pilot-Akzeptanztest mit realen Nutzern.
- Post-MVP: Autorisierungs-, Satzversions-, historische Reproduzierbarkeits-, Plan-/Ist-Kosten-, Maschinenverleih-Erlös- und Scope-Boundary-Tests.

## 22. Observability und Monitoring

Zu beobachten sind mindestens:

- Login- und Autorisierungsfehler.
- Planveroeffentlichungen, Blockaden und Uebersteuerungen.
- Bestaetigungsdauer, Ablehnungen, Erinnerungen und Eskalationen.
- E-Mail-/In-App-Zustellung und Fehler.
- Timer, lange Timer, Freigaben und Korrekturen.
- Geraetesperren, betroffene Reservierungen und Freigaben.
- Anbieterfehler und Kosten fuer E-Mail, Routing, Transkription, Storage, PDF und Wetter.
- Wetter-Latenz, Fehlerquote, Cache-Treffer, veraltete Daten und Rate Limits.
- Health- und Readiness-Checks.
- Fehlgeschlagene Backups und haengende Jobs.
- Produktmetriken fuer Planungsabdeckung, Informationsqualitaet und Nutzerakzeptanz.
- Post-MVP: Änderungen von Satzversionen, Berechnungsfehler, nicht auflösbare Quellen, rückdatierte Korrekturen, Berichts-/Exportzugriffe und unerlaubte Zugriffsversuche.

## 23. Risikoregister

Hauptgefahren:

- Umfangsueberladung des breiten MVP.
- Geringe Mitarbeiterakzeptanz.
- Datenleck durch falsch konfigurierte Berechtigungen.
- Unsichere Geraetefreigabe.
- Verlorene oder verspaetete Benachrichtigungen.
- Datenschutzrisiken bei Arbeitszeit, Abwesenheit, Fotos und privatem Startpunkt.
- Veraltete Offline-Daten.
- Anbieterabhaengigkeit und Kosten.
- Konfigurationsdrift.
- Fehlerhafte CSV-Migration.
- Vergessene Timer.
- Fehlende rechtliche Aufbewahrungsentscheidung.
- Veraltete oder ungenaue Wetterdaten werden als verbindliche Sicherheitsinformation missverstanden.
- Post-MVP: Offenlegung vertraulicher Personen-/Ressourcensätze.
- Post-MVP: Historische Kosten verändern sich durch überschriebene oder falsch wirksame Sätze.
- Post-MVP: Interne Übersicht wird fälschlich als Lohn-, Rechnungs-, Steuer- oder Buchhaltungssystem verwendet.

Die Maßnahmen sind im kanonischen Risikoregister und der Traceability-Matrix hinterlegt. Ergänzt sind insbesondere Warnaktualität, räumliche Fehlinterpretation und die getrennte Supabase-Storage-Sicherung.

## 24. Rollback und Checkpoints

- Jede Phase endet mit getaggtem Stand, Testbericht und menschlicher Freigabe.
- Datenmigrationen benoetigen Rollback oder getesteten Restore-Weg.
- Veroeffentlichung, Import und Bulk-Aenderungen erhalten Transaktions- beziehungsweise Batch-Grenzen.
- Externe Komfortfunktionen sind per Feature Flag abschaltbar.
- PWA-Cache besitzt Versionierung und Invalidierung.
- Der Pilot kann bei kritischen Fehlern auf den bisherigen Planungsprozess zurueckfallen.
- Restore aus Backup wird vor Produktion geprobt.
- Post-MVP-Planungsökonomie ist per Feature Flag abschaltbar; ein Rollback darf Planungen, freigegebene Zeiten, Ressourcennutzung oder Audit-Historie nicht verändern.

## 25. Definition of Done

Das Produkt ist fuer das erste Release fertig, wenn:

- alle P0-Anforderungen Akzeptanzkriterien, Tests und Tasks besitzen;
- Clickdummy und zentrale Journeys mit Stakeholdern getestet sind;
- serverseitige Autorisierung fuer alle sensiblen Rechte bestanden ist;
- Blockadekonflikte nicht veroeffentlicht werden koennen;
- Benachrichtigungen nachvollziehbar und verlaesslich sind;
- Schaeden, Freigaben und Zeitkorrekturen ihre Historie behalten;
- Browser-, Accessibility-, Performance-, Offline- und Upload-Tests bestehen;
- Backup und Restore getestet sind;
- Anbieter-ADRs, Datenfluss, Retention, Datenschutzinformationen und Runbooks freigegeben sind;
- im MVP keine Lohn-, Kosten-, Erlös-, Rechnungs-, Geofencing- oder Trackingfunktionen vorhanden sind; die Post-MVP-Planungsökonomie ist nicht Teil der MVP-Abnahme;
- Repository-spezifische CI-Validierung erfolgreich ist;
- Pilotmetriken ausgewertet und kritische Rueckmeldungen bearbeitet sind.
- Wetter für heute und den Folgetag zuweisungsbezogen sichtbar ist, alle beschlossenen Werte und Tagesabschnitte enthält, amtliche DWD-Warnungen aktuell und prominent darstellt und ein Anbieterausfall die Einsatzansicht nicht blockiert.
- keine Mitarbeiterortung für Wetter stattfindet und keine automatische wetterbasierte Absage oder Arbeitsstopp-Entscheidung existiert.
- Mitarbeiterlebenszyklus sowie der Mindest-Pilotdatensatz mit zwoelf Mitarbeitern und drei parallelen Baustellen getestet sind.

## 26. Agenten-Handoff

Ein Coding Agent muss:

- dieses PRD und `prd_report.json` als Source of Truth verwenden;
- phasenweise arbeiten;
- vor Codebeginn ADRs und Repository-Validierung klaeren;
- keine Datenfelder, Berechtigungen, Statusuebergaenge oder Anbieterannahmen erfinden;
- Domaenenlogik von UI, Persistenz und Anbieteradaptern trennen;
- Autorisierung niemals umgehen;
- keine Lohn-, Rechnungs-, Umsatzsteuer-, Zahlungs-, Buchungs-, GPS-, Geofencing-, ERP- oder unbegrenzten No-Code-Funktionen hinzufuegen;
- die Post-MVP-Anforderungen FR-062 bis FR-070 nicht während des MVP implementieren;
- Tests und Rollback-Nachweise mit jeder Aenderung liefern;
- bei Widerspruch, destruktiver Migration, neuem Anbieter oder unklarer geschuetzter Logik stoppen und Rueckfrage stellen.

---

## Finale Entscheidung

**PRD-Entscheidung:** FREIGEGEBEN.  
**Clickdummy:** BEREIT.  
**Implementierungsplanung:** BEREIT, beginnend mit ADRs und Repository-Setup.  
**Produktionsbetrieb:** NOCH NICHT FREIGEGEBEN.
