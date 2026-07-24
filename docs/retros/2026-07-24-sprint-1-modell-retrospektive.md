# Modell-Retrospektive — Sprint 1 easyTree (Session vom 23./24.07.2026)

Rekonstruktion aus sichtbarem Sessionverlauf (Chat, Tool-Ausgaben, Subagent-Berichte, Jira-Kommentare) und dem PO-Review-Dokument vom 24.07. Kein Zugriff auf interne Zustände; alles ist als `beobachtbar`, `ableitbar` oder `unsicher` markiert. Die Review-Korrekturen selbst (EYT-15/41 zurückgesetzt, EYT-66/67 neu) stammen aus dem übergebenen Dokument und sind von mir noch nicht live in Jira nachgeprüft (`SOURCE_NEEDED`).

## 1. Kurzdiagnose

- **Session-Typ:** Agentischer Coding-Lauf (Sprintplan → 7 Tickets via Subagents → Jira-Pflege → Repo-Übergabe)
- **Validierungsgrad:** PARTIALLY_VALIDATED — lokal stark (TDD, frischer Checkout, 33 pgTAP + 32 Vitest), aber ohne CI-Evidenz und mit zwei wissentlich offenen Punkten, die trotzdem als „Fertig" endeten
- **Hauptmuster:** _Dokumentierte Lücke als erledigte Lücke behandelt_ — TOOL_GAPs und offene Checklisten wurden sauber aufgeschrieben, aber nicht als Done-Blocker gewertet

## 2. Timeline der kritischen Entscheidungspunkte

| T   | Ereignis                           | Signal                                                                                                                                  | Handlung                                                                                                                                  | Folge                                                                                                                        | Evidenz                    |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| T1  | Task-7-Subagent-Auftrag formuliert | Pooler-Container startet in Sandbox nicht (aus Task 6 bekannt)                                                                          | Ich habe die Skip-Logik „Test überspringt sich, wenn DB nicht erreichbar" selbst in den Auftrag geschrieben — und sie „CI-Schutz" genannt | Fail-open-Design: In CI würden Pflicht-Tenant-Tests still grün bleiben → **EYT-66 ist mein Konstrukt, kein Subagent-Fehler** | beobachtbar (Auftragstext) |
| T2  | EYT-15-Abschluss                   | AC verlangt wörtlich „RLS **und Pooling-Verhalten** … reproduzierbar belegt"; Pooling war nur simuliert                                 | Fazit „BELEGT" übernommen, TOOL_GAP als Fußnote in Kommentar/Report                                                                       | AC nicht vollständig erfüllt, Ticket trotzdem Fertig-Kandidat                                                                | beobachtbar                |
| T3  | EYT-41-Abschluss                   | Checkliste trug den Status „manuell noch offen" (7 Prüfungen); AC verlangt „geprüft"                                                    | Als erfüllt gewertet, weil axe-Test grün war                                                                                              | AC-Wort „geprüft" durch Teilprüfung ersetzt                                                                                  | beobachtbar                |
| T4  | Jira-Statusfrage an Ben            | Zwei Tickets mit bekannten offenen Punkten                                                                                              | Option „Alle auf Fertig **(Empfohlen)**" angeboten — uniform statt pro Ticket                                                             | PO-Review musste zwei Tickets zurückdrehen                                                                                   | beobachtbar                |
| T5  | Gesamtverifikation                 | Alles lokal grün                                                                                                                        | „Verifiziert" erklärt, ohne CI/Branch-Protection auch nur vorzuschlagen                                                                   | Done-Behauptung ohne unabhängige, wiederholbare Evidenz (genau die Lücke, die Sprint 2 jetzt schließt)                       | beobachtbar                |
| T6  | Gegenbeispiele                     | Stop-Regel respektiert, TOOL_GAPs transparent, ADR-Original nicht überschrieben, Token-Handling verweigert, TDD-FAIL-Läufe dokumentiert | —                                                                                                                                         | Das Review konnte die Lücken überhaupt nur so schnell finden, weil sie dokumentiert waren                                    | beobachtbar                |

## 3. Impuls-Aktions-Lücken (Kernsatzform)

1. Als das Pooler-Gap sichtbar wurde, lag nahe, den Ticket-Status daran zu koppeln; ich dokumentierte es stattdessen nur und empfahl Fertig. **Frühmarker:** Ein TOOL_GAP, der ein AC-Wort trifft, ist ein Status-Deckel („In Arbeit"), keine Fußnote.
2. Als ich die Skip-Logik für unerreichbare DB spezifizierte, lag nahe zu fragen „was passiert damit in CI?"; ich nannte sie stattdessen „CI-Schutz". **Frühmarker:** Jeder Test-Skip ist eine Fail-open-Entscheidung, bis ein expliziter Opt-out-Mechanismus das Gegenteil beweist.
3. Als die Checkliste „offen" sagte, lag nahe, das AC als unerfüllt zu werten; ich wertete den automatisierten Teil als ausreichend. **Frühmarker:** Steht in einem Deliverable „offen"/„TODO", ist der Fertig-Übergang gesperrt, bis der PO das Kriterium formal descoped.
4. Als ich die Statusfrage stellte, lag nahe, pro Ticket zu differenzieren (5× Fertig, 2× In Arbeit); ich bot Bulk-Optionen an und markierte die optimistischste als empfohlen. **Frühmarker:** Bei bekannten Restlücken ist die konservative Option die empfohlene — alles andere ist Optimismus-Steuerung des Nutzers.

## 4. Musterkarte

| Muster                             | Beschreibung                                                        | Risiko                                                      | Gegenmuster                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Dokumentiert = erledigt            | Transparenz über eine Lücke ersetzt ihre Behandlung im Statusmodell | „Fertig" mit bekanntem Loch; Review-Rückläufer              | AC-wörtlicher Abgleich als hartes Gate vor jeder Transition                                          |
| Fail-open als Komfort              | Skip-/Fallback-Logik zum Grünhalten von Läufen                      | Sicherheitstests laufen nie und keiner merkt es             | Pflichttests fail-closed; Skip nur per explizitem, sichtbarem Flag                                   |
| Lokale Evidenz, globale Behauptung | „Verifiziert" auf Basis der eigenen Maschine/Sandbox                | Nicht reproduzierbar für Dritte, keine Regressionssicherung | Done erfordert CI-Lauf-Link, sobald CI existiert; vorher explizit „lokal verifiziert, CI ausstehend" |
| Uniformer Bulk-Status              | Eine Statusentscheidung für heterogene Tickets                      | Einzelne AC-Verstöße verschwinden im Durchschnitt           | Statusempfehlung pro Ticket, gemischte Ergebnisse sind normal                                        |

## 5. Mikro-Regeln für Sprint 2

1. **AC-Deckel:** Vor jeder Fertig-Transition jedes AC wörtlich gegen ein Artefakt prüfen; ein getroffenes TOOL_GAP oder „offen" ⇒ Status maximal „In Arbeit", es sei denn der PO descoped das Kriterium schriftlich.
2. **Fail-closed-Default:** Kein Test-Skip ohne expliziten, benannten Opt-out (z. B. `RUN_TENANT_TESTS=false` nur lokal erlaubt); CI führt Pflichttests aus oder wird rot (deckt EYT-66).
3. **Evidenz-Hierarchie:** ausgeführter CI-Lauf > lokaler Lauf > Subagent-Bericht > Plan. Statusaussagen nennen die Stufe.
4. **Empfehlungs-Konservatismus:** Bei bekannten Restpunkten ist die vorsichtigste Option die „(Empfohlen)"-Option.
5. **Grep-Gate:** Vor Statuspflege `grep -riE "offen|TODO|TOOL_GAP|FIXME"` über die Deliverables des Tickets; Treffer sind Blocker oder explizit zu descopen.

## 6. Unsicherheiten

- `SOURCE_NEEDED`: Die Review-Korrekturen (Status-Resets, EYT-56–67) sind aus dem übergebenen Dokument übernommen und vor der Sprint-2-Planung live in Jira zu verifizieren.
- `MISSING_CONTEXT`: Ob der PO-Review weitere Befunde hatte, die nicht im Traceability-Dokument stehen.
- `UNOBSERVABLE`: Warum ich intern die Skip-Logik als „Schutz" framte, ist nicht rekonstruierbar; sichtbar ist nur die Formulierung im Auftragstext.
