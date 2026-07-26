# Clickdummy-Scope-Matrix

Legende: **vorhanden** = interaktiv im Prototyp; **teilweise** = nur simuliert/unvollständig; **fehlt** = nicht ausreichend vorhanden.

| PRD-Clickdummy-Ansicht | Planer UIUX | Mitarbeiter App-UI | Master | Gesamtstatus | Nächster Schritt |
|---|---|---|---|---|---|
| Login / Passwort-Reset | fehlt | fehlt | technische Auth-Entscheidung, keine UI | fehlt | Auth-Screens als gemeinsamer Einstieg bauen |
| Mobile Startseite / nächster Einsatz | – | vorhanden | Shell | vorhanden | in Master-Route migrieren |
| Wochenansicht | vorhanden (Planer) | vorhanden (Mitarbeiter) | – | vorhanden | gemeinsame Verträge/IDs verwenden |
| Monats-/Vier-Wochen-Orientierung | vorhanden | fehlt | – | vorhanden für Planer | mobile Lesesicht festlegen |
| Baustellendetail | vorhanden | vorhanden | – | vorhanden | ein gemeinsames Worksite-Modell festlegen |
| Wetter / Warnungen | vorhanden als Mock | vorhanden als Mock | Adapterentscheidung dokumentiert | teilweise | Mock klar kennzeichnen; Warnungszustände testen |
| Wochenbestätigung | – | vorhanden | – | vorhanden | Planversion und Re-Confirmation darstellen |
| Begründete Terminablehnung | – | vorhanden | – | vorhanden | Pflichtkategorie/-text und Statusfolge schärfen |
| Abwesenheit / Urlaubsantrag | Planer-Mock | vorhanden | – | vorhanden | Genehmigungsweg und Statusansicht ergänzen |
| Arbeitszeit Start/Stop | – | vorhanden, aber fehleranfällige Demo | – | teilweise | Timestamp-basierten Clickdummy-Zustand bauen |
| Arbeitszeitfreigabe / Korrektur | fehlt | nur „zur Freigabe“ | – | fehlt | Admin-Ansicht mit Original/Korrektur hinzufügen |
| Geräte/Fahrzeuge / Zustandsmeldung | vorhanden | vorhanden | – | vorhanden | gemeinsame Ressourcen-ID und Zustandsfolge |
| Rollen-/Berechtigungseditor | nur Rollen-Simulation | Profilanzeige | RLS-Foundation | fehlt | Editor-Clickdummy mit atomaren Rechten |
| Konflikte / Veröffentlichung | vorhanden, simuliert | nur Empfang | – | teilweise | Planversion, Blocking/Warning und Empfängerstatus ergänzen |

## Empfohlene Clickdummy-Zielversion

Eine zusammenhängende Demo mit drei Rollen:

1. **Geschäftsführung:** Monats-/4-Wochen-Übersicht, Kennzahlen, Read-only/Review.
2. **Administrator/Planer:** Woche bearbeiten, Konflikte lösen, veröffentlichen, Zeiten/Abwesenheiten freigeben.
3. **Mitarbeiter:** eigenen Einsatz sehen, bestätigen/ablehnen, Zeit erfassen, Abwesenheit und Zustandsmeldung einreichen.

## End-to-End-Demoszenario

1. Admin meldet sich an und öffnet Woche 32.
2. Mitarbeiter mit passender Qualifikation wird einer Baustelle zugewiesen.
3. Eine zweite überlappende Zuweisung löst einen Blocker aus.
4. Admin korrigiert den Konflikt und veröffentlicht Planversion 3.
5. Mitarbeiter sieht Version 3, bestätigt die Woche und startet am Einsatztag die Zeit.
6. Mitarbeiter meldet einen Geräteschaden.
7. Admin sieht Meldung und gibt die eingereichte Arbeitszeit frei beziehungsweise korrigiert sie begründet.
8. Geschäftsführung prüft Monatsübersicht und offene Risiken.

Dieser Ablauf testet den Übergang der beiden UI-Welten besser als isolierte Screens.
