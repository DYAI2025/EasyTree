# EYT-125 — Baustellenzentrierte Planung: Zielarchitektur + Implementierungsslice

> **Für Claude:** PFLICHT-SUB-SKILL: `superpowers:executing-plans`.
> **Status:** `derived_noncanonical` — vom Orchestrator NICHT zur Ausführung freigegeben.
> **Revision 9** (01.09.2026): **einziges Delta — F4, Vereinheitlichung des
> N6-Concurrency-Vertrags.** Der Plan trug für denselben Fall `publishPlan` ↔
> `createAssignment` zwei unvereinbare Wahrheiten: B.4.3 beschrieb seit Revision 7 die
> F2-Serialisierung mit den Interleavings A1/A2/B/C, während B.4.4 und M5 noch die Erwartung
> **vor** F2 führten — „kommt der Publish zuerst durch, lehnt der Bestandstrigger die Zuweisung
> mit `23514` ab" bzw. „Ergebnis ∈ {mitveröffentlicht, `23514` abgelehnt}". Ab Revision 9 gilt
> genau **eine** Fassung: N6 prüft **alle vier** Fälle A1, A2, B und C, jeden mit einem in B.4.5
> benannten Haltepunkt, und **`23514` ist in keinem davon ein zulässiger Ausgang** — tritt es
> auf, ist N6 rot. Der Trigger `assignments_reject_published_plan` bleibt unverändert als
> Tiefenverteidigung; dass er scharf ist, belegt Guard 4b unter `ohnePublishRecht` (M4), nicht
> ein Wettlauf. Fall **B** war bisher nirgends als N6-Durchlauf geführt und ist neu; Fall **C**
> nennt jetzt den realen Bestandsausgang beim Namen (`planning-write.repository.ts`: ohne
> Entwurf und ohne veröffentlichte Version `STALE_VERSION` mit `aktuelleVersionId: null`, mit
> veröffentlichter Version `ALREADY_PUBLISHED` — beides 409, beides veröffentlicht nichts). Die
> drei Gegenmutationen heißen jetzt **GM-N6-1** (Personensperre zurück vor den Entwurfsschritt),
> **GM-N6-2** (Wiederholungsrunde entfernt) und **GM-N6-3** (Klasse-(2)-Lock auf plain `select`
> degradiert); „kein `40P01`" ist in **jedem** N6-Durchlauf PASS-Kriterium, damit GM-N6-1 keinen
> scheinbaren PASS erzeugen kann. **Keine Produkt-, DB-, Contract- oder API-Architektur
> geändert** — F4 ist ein Konsistenzrepair des Test- und Concurrency-Vertrags.
> **Unverändert:** F1 (`app.read_idempotency_result`, P1–P5), F2 (`app.lock_week_draft`:
> `for share`, Wiederholungsrunde, `55P03`), **O1**, F3 (Exact-One-Org-Auflösung) und
> **O2a/O2b/O2c**, Assignment-Grants, `app.remove_assignment_from_worksite_day`,
> WorksiteDay-/Configuration-Architektur, `published_at` als einzige Publish-Wahrheit,
> `team: []`-Verbot, Multi-Interval-Scope, Kosten-/Employee-Projektion, EYT-114-/EYT-150-Grenze.
> Zwei Sätze in älteren Revisionsabsätzen beschreiben ausdrücklich **den damaligen** Stand und
> bleiben als Historie stehen: „**N6** deckt jetzt A1/A2/C ab" (Revision 7) und „**N6** bewusst
> nicht angefasst" (Revision 8). Normativ ist ab hier allein A1/A2/B/C.
> **Revision 8** (01.09.2026): **einziges Delta — F3, Mandantenbindung von
> `app.lock_week_draft`.** Revision 7 hat den Klasse-(2)-Erwerb korrekt in eine
> `security definer`-Funktion verlagert, die Organisation dort aber als **Menge** gefuehrt
> (`org_id in (select app.user_org_ids())`). Unter `security definer` laeuft die Funktion als
> Eigentuemer mit BYPASSRLS — die Mengenform ist dort keine Grenze, sondern eine Auswahl.
> Gemessen an genau dieser Form: bei zwei Organisationen ohne Entwurf wirft
> `RETURNING … INTO` `P0003` (auch ohne `strict`), bei „A hat Entwurf, B nicht" legt sie
> **still** einen Entwurf in B an und meldet Erfolg (symmetrisch auch umgekehrt), ohne
> Organisation laeuft sie drei Runden und endet in `55P03`. Die Funktion loest jetzt **vor**
> jedem Insert und jedem Select genau eine aktive Organisation auf (`array_agg` ueber
> `app.user_org_ids()`; null oder mehr als eine ⇒ `42501`), prueft `planning.write` auf dieser
> einen Organisation und bindet jeden Zugriff an `org_id = v_org`; der Insert nennt `v_org`
> als Wert, der Lesezugriff auf `public.organizations` entfaellt (der Fremdschluessel von
> `plan_versions` prueft die Existenz weiterhin). Kein Org-Parameter, kein
> `order by … limit 1`. Neuer Pflichttest **O2** (a: genau eine Organisation; b: keine; c:
> zwei, in drei Entwurfskonstellationen) mit benannter Gegenmutation. **Unveraendert aus
> Revision 7:** die F2-Mechanik vollstaendig (`for share`, Wiederholungsrunde, Fehlausgang
> `55P03`), **O1**, die Sperrordnung B.4.3, **N3/N3b** — und **N6 bewusst nicht angefasst**:
> der Orchestrator hat dort einen Widerspruch zwischen B.4.3, B.4.4 und M5 gefunden, der
> ausdruecklich dem naechsten Review vorbehalten bleibt, damit dieser Repair genau einen
> Befundcluster bewegt. **Unveraendert aus Revision 6:** F1 (`app.read_idempotency_result`),
> **P1–P5**, die `result_payload`-Grants. Die Mengenform in
> `app.remove_assignment_from_worksite_day` (B.2 Block 5) bleibt **absichtlich** stehen: dort
> ist `org_id not in (select app.user_org_ids())` eine Mitgliedschafts-**Pruefung**, die
> ablehnt, keine Auswahl, die zuteilt.
> **Revision 7** (01.09.2026): **einziges Delta — F2 (Befund 2 des Orchestrator-Reviews vom
> 01.09.2026: Sperrordnung und Helfer-Postcondition; nicht zu verwechseln mit dem
> `0016-F2-Muster` in B.2 Block 4b, das ein Sichtbarkeitsmuster bezeichnet).**
> `entwurfSicherstellen` trägt jetzt eine harte Postcondition: der Helfer kehrt **nur mit
> gehaltenem Klasse-(2)-Lock** auf der Draft-Zeile zurück. Erfüllt wird sie über die neue
> Domain-Funktion `app.lock_week_draft` (B.2 Block 8) — `security definer` **mit
> Wiederholungsrunde**, weil zwei Messungen die naive Form widerlegt haben: ein Invoker-
> `for share` im Anwendungscode liefert ohne `planning.publish` **keine Zeile** (die
> UPDATE-Policy-USING-Klausel greift mit), und nach einem Publish-Commit liefert `for share`
> wegen EvalPlanQual **0 Zeilen** statt eines benannten Konflikts. Damit entfällt die letzte
> `5 → 2`-Erstakquisition, und „alle vier Pfade nehmen ihre Klassen aufsteigend" gilt — sofern
> der Helfer erfolgreich zurückkehrt; sein Fehlausgang ist benannt (`55P03`). Neuer Test **O1**
> (existing-draft-Lockordnung, inklusive `ohnePublishRecht`), **N6** deckt jetzt A1/A2/C ab,
> **N2b** ist neu abgeleitet (der frühere Wettlauf ist nach F2 unerreichbar), und der
> Publish-Crosscheck ist über vier gemessene Interleavings neu geschrieben.
> Außerdem historische F1-Formulierungen präzisiert: die Revision-5-Fassung wählte vor der
> Tenant-Bindung aus und verwarf die fremde Zeile danach (Replay-Miss) — sie gab sie nicht
> heraus. **F1: die ausführbaren Anweisungen von `app.read_idempotency_result` (Operation →
> Kanal → `array_agg`-Orgauflösung → `has_permission` → org-gebundener Payload-Select →
> `not found ⇒ null`), P1–P5, Grants und Tests sind unverändert; geändert wurden dort
> ausschließlich Kommentarzeilen.**
> **Revision 6** (01.09.2026): **einziges Delta — F1, Tenant-Auflösung in
> `app.read_idempotency_result`.** Revision 5 suchte den Payload über
> `where operation = … and idempotency_key = …` ohne `org_id`. Unter `security definer` gibt es
> keine RLS-Filterung, und der Unique-Schlüssel von 0012 ist `(org_id, operation,
idempotency_key)` — zwei Organisationen dürfen denselben Schlüssel führen. Die Funktion löst
> die Organisation jetzt **vor** der Auswahl deterministisch aus dem authentisierten Kontext auf
> (`array_agg` über `app.user_org_ids()`, nicht genau eines ⇒ `42501`; kein `order by … limit 1`, kein
> Org-Parameter, fail-closed nach dem bestehenden Single-Organisation-Vertrag), prüft
> `planning.write` auf dieser Organisation und bindet `org_id` in der Payload-Abfrage. Neuer
> Pflichttest **P5** (gleicher Operation/Key in zwei Organisationen). Alles Übrige aus
> Revision 5 ist **unverändert** — insbesondere die Lesegrenze auf Spaltenebene (B.5 und B.2
> Block 7, `revoke select on table` + Spalten-Grant), die Sperrordnung B.4.3, der
> `createAssignment`-Reorder und N3/N3b/N6. (Das Kürzel „F2" des Orchestrator-Reviews wird hier
> bewusst nicht verwendet: es ist im Dokument nicht definiert, und „0016-F2-Muster" in B.2
> Block 4b bezeichnet etwas anderes.) **Bindend ist der SHA-256 dieser Datei**, nicht die
> Revisionsnummer allein.
> **Revision 5** (31.08./01.09.2026): zwei Blocker der Revision-4-Abnahme behoben — (1) die
> Lesegrenze für `result_payload`. **Nachgeschärft (R5-1):** RLS filtert Zeilen, nicht Spalten —
> die Grenze sitzt deshalb auf dem **Spaltenrecht** (`revoke select on table` + Spalten-Grant
> ohne `result_payload`) mit `app.read_idempotency_result` als einziger, kanal-, rechte- und
> operationsgebundener Lesestelle; die SELECT-Policy bleibt unverändert. Dazu die Klarstellung,
> dass `result_payload` historische Command-Evidenz ist und **nicht** demselben Maßstab wie
> `audit_events.context` unterliegt; (2) die
> Sperrreihenfolge von `createAssignment` (Personensperre hinter `entwurfSicherstellen`),
> womit die beiden bekannten Deadlock-Paare entfallen und N3/N3b `40P01` nicht mehr als
> vorgesehenen Ausgang führen — **nachgeschärft (R5-3/R5-4):** N3/N3b erzwingen Gleichzeitigkeit
> über eine Barriere (B.4.5), und der Publish-Crosscheck bekommt mit **N6** einen eigenen
> synchronisierten Regressionstest. Dazu die Scope-Präzisierung: Multi-Interval bleibt in
> Modell, Contract, API und Anzeige, das UI-Authoring gehört EYT-121.
> **Revision 4** (31.08.2026). Revision 3 trennte Zielarchitektur (Teil A) vom
> Implementierungsslice (Teil B), trennte die stabile Tagesidentität von der Revision,
> korrigierte den Idempotenz-Replay auf die ERSTE Antwort, schloss leeren Tag und Publish,
> band die Entfernen-Grenze fachlich, vervollständigte Sperrordnung und Preservation-Matrix.
> Revision 4 arbeitet zwei adversariale Prüfrunden ein (44 Befunde, 5 Blocker): N2 in N2a/N2b
> aufgelöst; Guard 4b für Löschkaskaden korrigiert (PostgreSQL-17.6-Messung); leeres Team
> verboten statt vertagt (samt Streichung des Konfliktcode-Paritätstests); Fingerprint-
> Kanonisierung und Replay-NULL-Zweig entschieden; Idempotenz-INSERT-Policy **operationsgebunden**
> verschärft (eine pauschale Fassung ließ `costs.create_rate_version` gemessen an RLS
> scheitern); Sperrordnung um Wiedereintritt und zweites Zyklus-Paar ergänzt;
> Katalog-Zusicherung gegen definer-Schreibpfade aufgenommen.

**Goal:** Die Baustelle — als expliziter, unabhängig prüfbarer Baustellentag mit **über
Revisionen stabiler Identität** — wird die eine sichtbare Planungseinheit der Werkbank.
Mitarbeitende bleiben ihr als untergeordnete Zuweisungen mit **eigenen** Intervallen zugeordnet
(mehrere Personen und mehrere Einsatzintervalle je Tag). Publish-, Kosten-, Konflikt- und
Employee-Projektion konsumieren weiter ausschließlich konkrete Assignments;
`plan_versions.published_at` bleibt die einzige autoritative Publish-Wahrheit; die
0017-Schreibkanalgrenze bleibt vollständig bestehen.

**Architecture:** Zwei Ebenen, strikt getrennt. **Identität**: `worksite_days` — eine Zeile je
(Organisation, Baustelle, lokaler Tag), versionsübergreifend stabil, ohne Planungsdaten.
**Revision**: `worksite_day_configurations` — eine Zeile je (Planversion, Baustellentag), trägt
den Nebenläufigkeits-Token und später die Tageskonfiguration; Assignments referenzieren **die
konkrete Konfigurationsrevision**. Weder die Identität noch die Konfiguration trägt eigene
Zeiten oder einen eigenen Publish-Marker.

**Tech Stack:** Supabase-Migration (append-only) + pgTAP, Zod-Contracts + generiertes OpenAPI,
NestJS-Planning-Modul (TenantQueryRunner, Idempotenz-Store), Next.js-Werkbank (PR-#101-Basis).

---

## 0. Geprüfter Stand (SHAs, Quellen, Evidenzstufe)

| Größe                                           | Wert                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin/master` (Analysebasis Contracts/API/DB) | `f8e96e4ceb4f00ae5f5ac777c6eb47aa8f766d6f`                                                                                                                                                                                                                                 |
| PR #101 Head (Analysebasis Web)                 | `b7917ab2cb2a3ec683ccdc0589fca8318e8b35bd` (OPEN, `reviewDecision` leer)                                                                                                                                                                                                   |
| PR #101 Base                                    | `f8e96e4c…` — Branch up to date gegen master                                                                                                                                                                                                                               |
| Lokaler Worktree                                | `feat/eyt-126-container-staging` @ `3b4bbdb`, Vorfahre von `origin/master`; `git diff HEAD origin/master -- packages/contracts apps/api/src supabase` **leer** → Worktree-Reads dieser Pfade gelten als master-Stand. `apps/web` ausschließlich über `git show b7917ab:…`. |
| PR-#101-Diff                                    | **nur `apps/web/**` + `docs/evidence/**`** — kein Contract, keine API, keine Migration                                                                                                                                                                                     |
| Jira                                            | EYT-147 (In Arbeit, fachlich blockiert), EYT-125 (Zu erledigen, Architekturgate), EYT-119/120/121/122/123/72 (Zu erledigen). **Jira-Drift:** gespeicherter Blocks-Link technisch invertiert; kanonisch **EYT-125 BLOCKS EYT-147**; keine Mutation.                         |
| Confluence                                      | 9306113 (fachliche Produktbaseline 30.07.), 38993921 §12 (`BLOCKED_DOMAIN_MODEL_RECONCILIATION`, 31.08.)                                                                                                                                                                   |

**Evidenzstufen.** **[S]** = in dieser Session selbst gelesen/gemessen. **[A]** =
Subagent-Report mit Datei-/Zeilenangabe, dessen tragende Aussage stichprobenhaft selbst
nachgemessen wurde. **[R]** = adversarialer Review-Befund mit zitiertem Beleg, nicht zusätzlich
selbst nachgelesen. Kein Befund, der eine Entscheidung trägt, steht allein auf **[R]**.
Aussagen, deren Messkommando fehlschlug, sind nicht als verifiziert geführt.

**Für Revision 3/4 neu gemessen [S]:**

- `idempotency_records` hält **nur** `subject_id` + `request_fingerprint`; der Kopf von 0012
  sagt wörtlich: „der Vertrag schuldet dem Aufrufer bei einer Wiederholung dieselbe Antwort"
  und „Ergebnis des ERSTEN Aufrufs". Grants: `select, insert`, **kein** update/delete („ein
  Idempotenzergebnis, das sich aendern laesst, ist keins").
- Audit-Kontext bei `planning.assignment_created` trägt `weekKey, planVersionId, employeeId,
worksiteId` — **Ids ja, Labels nein** („CLAUDE.md verbietet Personendaten im Kontext, und
  `label` waere genau das"). Outbox-Payload: `{ assignmentId, weekKey }`. Das ist der Maßstab
  für den Inhalt eines gespeicherten Idempotenzergebnisses (§B.5).
- `blockierendeKonflikte(zeilen, org)` ist der Publish-seitige Konfliktpfad; er faltet
  `validateDraft` über alle Zuweisungen der Version und übersetzt über
  `KONFLIKT_TEXT: Record<ConflictCode, string>`.
- **Befund gegen CLAUDE.md:** ein Test „jeder Domaincode hat eine Transport-Entsprechung" ist
  unter `apps/api/test` und `packages/contracts/test` **nicht auffindbar**
  (`grep -rn "CONFLICT_CODES" …` → keine Treffer). Faktischer Wächter ist allein die
  `Record<ConflictCode, …>`-Typisierung von `KONFLIKT_TEXT` (tsc). Ein neuer Code erzwingt
  damit den Text-Eintrag, **nicht** den Transport-Eintrag. Der Slice braucht diesen Wächter
  nach der B.6-Entscheidung nicht mehr (er fügt keinen Konfliktcode hinzu); die Lücke bleibt
  als MISSING in §15 stehen.

---

## R. Requirements (IDs, Quelle, Erfüllungsort)

| ID       | Anforderung                                                                                                                                                                               | Quelle                    | Erfüllt in                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| R-01     | Stabile Tagesidentität über Draft → Publish → Folgedraft                                                                                                                                  | EYT-121 AK1, Finding 2    | A.2, B.2                                                       |
| R-02     | Baustellentag = eine sichtbare Einheit; Assignments untergeordnet                                                                                                                         | 38993921 §12, EYT-72      | B.8, Test A                                                    |
| R-03     | Mehrere Mitarbeitende je Tag                                                                                                                                                              | 9306113 §4.2              | B.7                                                            |
| R-04     | **Mehrere Einsatzintervalle je Tag**; Intervall je Zuweisung — **Modell, Contract und API in Slice 1; das UI-Authoring mehrerer/individueller Intervalle je Person gehört EYT-121** (B.8) | 9306113 §4.2              | B.3, B.8, Test F (Modell/Contract/API, **nicht** UI-Authoring) |
| R-05     | Bearbeitbarer Draft                                                                                                                                                                       | 9306113 §4.3              | B.7                                                            |
| R-06     | Veröffentlichte Revision unveränderlich                                                                                                                                                   | 9306113 §4.3              | B.2 Blöcke 4a/4b, Test E                                       |
| R-07     | Änderung → neuer Draft/neue Revision; Original ↔ Revision korrelierbar                                                                                                                    | 9306113 §4.3, Finding 2   | A.2, B.9, Test E                                               |
| R-08     | Kosten nur aus veröffentlichten konkreten Zuweisungen; Snapshots stabil                                                                                                                   | 9306113 §4.5              | §9, Test L                                                     |
| R-09     | Optimistic Concurrency ohne Lost Update                                                                                                                                                   | EYT-121                   | B.4, Tests N1–N5                                               |
| R-10     | Teamänderung atomar, idempotent, autorisiert, auditiert                                                                                                                                   | EYT-119                   | B.7, Tests B/I/J/K1                                            |
| R-11     | Tenant-FKs, RLS, Ablehnung ohne Informationsleck                                                                                                                                          | EYT-121                   | B.2, Test H                                                    |
| R-12     | Keine zweite Planungs-, Ressourcen- oder Kostenwahrheit                                                                                                                                   | EYT-125                   | B.3, B.4, §9                                                   |
| R-13     | 0017 unangetastet: keine pauschalen UPDATE-/DELETE-Grants auf `assignments`                                                                                                               | Finding 5, pgTAP 0012 [S] | B.2 Block 6, Test K                                            |
| R-14     | Migration append-only, nicht destruktiv                                                                                                                                                   | EYT-125                   | B.2, §12                                                       |
| R-15     | `AssignmentDto`-/published-assignment-Projektion erhalten                                                                                                                                 | Finding 7                 | §9                                                             |
| R-16     | Worksite = Stammdaten; keine EYT-16-Expansion; Slice wählt existierende Baustelle                                                                                                         | Finding 1 B               | B.0, B.3                                                       |
| R-17     | Kein Backfill; veröffentlichte Historie nicht reinterpretiert                                                                                                                             | Finding 7                 | B.9, Tests G/L                                                 |
| R-18     | Audit + Outbox je Command in derselben Transaktion                                                                                                                                        | Bestandspraxis [S]        | B.7                                                            |
| R-19     | `plan_versions.published_at` einzige autoritative Publish-Wahrheit                                                                                                                        | Finding 7                 | A.3, B.2                                                       |
| R-20     | Genau eine kohärente Stale-Wahrheit je Objekt/Command                                                                                                                                     | Finding 6                 | B.4                                                            |
| **R-21** | **Replay liefert das Ergebnis des ERSTEN Aufrufs, nicht den aktuellen Stand**                                                                                                             | Finding 3, 0012 [S]       | B.5, Test K1                                                   |
| **R-22** | **Ein leerer Baustellentag ist niemals stillschweigend veröffentlichbar**                                                                                                                 | Finding 4                 | B.6, Tests M0 und M                                            |
| **R-23** | **Entfernen ist fachlich gebunden (Assignment ⊆ erwartete Tageskonfiguration); kein allgemeiner DELETE-Mechanismus**                                                                      | Finding 5                 | B.2 Block 6                                                    |
| **R-24** | **Vollständige, geprüfte Sperrordnung über alle beteiligten Commands**                                                                                                                    | Finding 6                 | B.4.3                                                          |
| **R-25** | **EYT-125 entscheidet die Zielarchitektur vollständig; der Slice realisiert nur die kleinste kompatible Untermenge**                                                                      | Finding 1                 | Teil A / Teil B                                                |
| **R-26** | **Assignments referenzieren die konkrete Konfigurationsrevision**                                                                                                                         | Finding 2                 | B.2 Block 5                                                    |

---

# TEIL A — ZIELARCHITEKTUR EYT-119 / EYT-125

Teil A ist die **Architekturentscheidung** des Gates EYT-125. Sie ist hier vollständig
entschieden; ihre Realisierung verteilt sich auf mehrere Tickets (A.9). Teil B implementiert
davon ausschließlich die kleinste kompatible Untermenge.

## A.1 Entitäten

| Entität                                         | Zweck                                                                                                                                                                                                                                                                       | Realisierung                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **`WorksiteDay`** (Identität)                   | genau ein lokaler Geschäftstag einer Baustelle, **versionsübergreifend stabil**; Adressat jeder Serien-, Diff- und Drilldown-Operation                                                                                                                                      | **Slice 1** (`worksite_days`)                              |
| **`WorksiteDayConfiguration`** (Revision)       | Planungsstand dieses Tages **innerhalb genau einer Planversion**: Nebenläufigkeits-Token, später Status, Tätigkeiten, Ressourcen, Hinweise                                                                                                                                  | **Slice 1** minimal (`worksite_day_configurations`: Token) |
| **`Assignment`** (Materialisierung)             | konkrete Person + Intervall, **untergeordnet einer Konfigurationsrevision**; einzige Quelle für Publish, Kosten, Konflikt, Employee                                                                                                                                         | Bestand + `worksite_day_configuration_id`                  |
| **`ContinuousWorksitePlan`** (Zeitraum)         | Klammer über die Tage einer fortlaufenden Baustelle: Start/Ende, Zeitraumstatus, Einreichung                                                                                                                                                                                | **EYT-120/123**; in Slice 1 bewusst nicht — A.1.1          |
| **`WorksiteDefaultConfiguration`** (Vorlage)    | Vorbelegung für die Tageserzeugung: Zeiten, Team, Tätigkeiten, Ressourcen. **Eigene Tabelle `worksite_default_configurations (id, org_id, worksite_id, …)` mit tenantgebundenem FK auf `worksites` — ausdrücklich KEIN Stammdatenfeld an `worksites` (R-16/EYT-16-Grenze)** | **EYT-120**                                                |
| **`WorksiteDefaultSnapshot`** (Vorlagenversion) | unveränderliche Fassung einer Vorlage, gegen die Abweichungen erklärbar bleiben. **Eigene Tabelle `worksite_default_snapshots (id, org_id, default_configuration_id, …)`, insert-only**                                                                                     | **EYT-120/122**                                            |
| **`DayOverride`** (Abweichungsnachweis)         | „weicht vom Default ab" — **abgeleitet**, kein gepflegtes Flag (A.4)                                                                                                                                                                                                        | **EYT-121/122**                                            |

### A.1.1 Warum `ContinuousWorksitePlan` nicht der Identitätsträger ist (begründet kleinere Ownership)

Die naheliegende Ownership `ContinuousWorksitePlan → WorksiteDay` scheitert an einem Fakt:
Baustellentage entstehen **auch ohne** Zeitraumplanung — genau das ist der heutige und der
Slice-1-Fall. Wäre der Zeitraum Eigentümer, müsste Slice 1 einen künstlichen Ein-Tages-Zeitraum
erfinden (Fachbehauptung ohne Command) oder die Identität später umhängen (Migration auf
veröffentlichten Daten — verboten).

Zielentscheidung: `worksite_days` ist **eigenständig** mit dem natürlichen Schlüssel
`(org_id, worksite_id, local_date)`. EYT-120 ergänzt **additiv** eine nullable Spalte
`continuous_worksite_plan_id`; ein Tag ohne Zeitraum bleibt gültig, ein Zeitraum gruppiert
bestehende Identitäten, ohne sie neu zu erzeugen. Das ist die kleinere Ownership im Sinne von
Finding 1 und hält EYT-120 anschlussfähig, ohne es vorzuziehen.

## A.2 Stabile Identität vs. Revision — Optionsvergleich und Entscheidung (Finding 2)

Vorbefund: die frühere Fassung kopierte Tageszeilen **mit neuer Id** in den Folgedraft und
nannte diese Id zugleich „stabil". Widersprüchlich: eine Id, die sich bei jeder Veröffentlichung
ändert, kann weder von EYT-122 adressiert noch von zwei Browsern als dieselbe logische Einheit
erkannt werden; Original ↔ Revision wären nur über `(worksite_id, local_date)` korrelierbar —
also über den natürlichen Schlüssel, den man dann auch zur Identität machen kann.

| Kriterium                                 | **B1** — getrennte Identitätszeile (`worksite_days` + `worksite_day_configurations`) | **B2** — nur Konfigurationszeilen mit `lineage_id`                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identität über Revisionen stabil          | ✓ eine Zeile, DB-Unique `(org_id, worksite_id, local_date)`                          | ✓ solange `lineage_id` korrekt propagiert wird                                                                                                                                       |
| Identität **fälschungssicher eindeutig**  | ✓ get-or-create über den natürlichen Schlüssel liefert immer dieselbe Id             | ✗ legt jemand denselben (Baustelle, Tag) im Folgedraft **direkt** an, statt ihn zu kopieren, entsteht eine ZWEITE `lineage_id` für dieselbe reale Einheit — Korrelation bricht still |
| Eindeutigkeit per DB durchsetzbar         | ✓ Unique auf der Identitätstabelle                                                   | ✗ mehrere Revisionen teilen `(worksite_id, local_date)`; ein die Lineage erzwingendes Unique ist nicht formulierbar                                                                  |
| EYT-122 adressiert Zieltage explizit      | ✓ `worksite_day_id` ist der Adressat                                                 | ⚠ nur mit garantierter Lineage                                                                                                                                                       |
| Tabellenzahl / Zeilen je Tag und Revision | 2 / 1 + 1                                                                            | 1 / 1                                                                                                                                                                                |

**Entscheidung: B1.** „Kleinste **robuste** Variante": B2 spart eine Tabelle, erkauft das mit
einer Invariante, die nur die Anwendung garantieren kann — und die genau in dem Fall bricht, für
den die Identität existiert. B1 macht sie zur DB-Eigenschaft.

**Pflichtinvarianten (Finding 2) und ihre Durchsetzung:**

| Invariante                                                      | Durchsetzung                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Tagesidentität bleibt über Draft/Publish/Folgedraft stabil      | `worksite_days`-Zeile wird nie kopiert; nur die Konfiguration wird je Revision materialisiert                         |
| Jede Revision besitzt eine eigene unveränderliche Konfiguration | Konfigurationszeile je `plan_version_id`; unveränderlich, sobald ihre Version veröffentlicht ist (Guard B.2 Block 4b) |
| Assignments referenzieren die konkrete Konfigurationsrevision   | `assignments.worksite_day_configuration_id` (R-26)                                                                    |
| Original und Revision eindeutig korrelierbar                    | über `worksite_day_id` beider Konfigurationszeilen                                                                    |
| EYT-122 kann stabile Zieltag-Ids adressieren                    | `applyDefaultToDays(worksiteDayIds[])` (A.4)                                                                          |
| Reload und zweiter Browser sehen dieselbe logische Tages-Id     | `WorksiteDayDto.worksiteDayId`; die Konfigurations-Id reist als eigenes Feld mit                                      |

## A.3 Beziehung zu `plan_versions`, Publish, Revision

`plan_versions` bleibt die **Revisionsklammer der Woche**, `published_at` die einzige
autoritative Publish-Marke (R-19). Weder `worksite_days` noch `worksite_day_configurations`
tragen einen eigenen Publish-Marker; ihr Veröffentlichungszustand wird über
`plan_version_id → plan_versions.published_at` **gelesen**.

1. Ein Entwurf je Woche (`plan_versions_one_draft_per_week`, Bestand).
2. Die erste Änderung nach einer Veröffentlichung erzeugt den Folgedraft als **Kopie**:
   Konfigurationen (neue Id, **gleiche** `worksite_day_id`, **übernommener** `lock_version`) und
   Assignments (neue Id, remapped auf die neuen Konfigurations-Ids).
3. Publish setzt `plan_versions.published_at`; Konfigurationen und Assignments dieser Version
   werden dadurch unveränderlich (neue Guards + Bestandstrigger).
4. Kosten lesen ausschließlich veröffentlichte Assignments (unverändert).

Die Übernahme von `lock_version` in die Kopie ist eine **Entscheidung**: der Token gehört
fachlich der Tagesidentität, nicht der Zeile. Ein Client, der eine veröffentlichte Konfiguration
mit `lockVersion = 3` bearbeitet, träfe sonst auf eine frische Kopie mit `0` und bekäme einen
Stale-Fehler, obwohl niemand konkurrierend geändert hat.

## A.4 Commands der Zielarchitektur

| Command                            | Zweck                                                                                                                                                                           | Ticket                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `planWorksiteDay`                  | Baustellentag mit Team anlegen (Identität get-or-create, Konfiguration im Draft, Zuweisungen)                                                                                   | **Slice 1**                                    |
| `updateWorksiteDayTeam`            | Team eines Baustellentags deklarativ auf einen Zielzustand bringen                                                                                                              | **Slice 1**                                    |
| `createContinuousWorksitePlan`     | Zeitraum + Kalendertagsauswahl anlegen                                                                                                                                          | EYT-120                                        |
| `saveWorksiteDefaultConfiguration` | Vorlage speichern → erzeugt einen **Snapshot**                                                                                                                                  | EYT-120                                        |
| `generateWorksiteDays`             | aus Zeitraum + Snapshot **explizite** Tageskonfigurationen materialisieren; idempotent über `(plan, worksiteDayId)`                                                             | EYT-120                                        |
| `previewApplyDefaultToDays`        | **schreibfreie** Vorschau je Zieltag: `unveraendert / ueberschrieben / abweichend-geschuetzt / konflikt / ausgeschlossen`                                                       | EYT-122                                        |
| `applyDefaultToDays`               | Serienanwendung auf **explizit genannte** `worksiteDayIds[]` mit `overwriteManuallyChanged: boolean`; idempotent, auditiert                                                     | EYT-122                                        |
| `setWorksiteDayStatus`             | Tagesstatus `arbeitsfrei/ausgesetzt/abgesagt` setzen — überführt einen Tag ohne Team in einen definierten, veröffentlichbaren Zustand und ist damit der in B.6 benannte Ausgang | EYT-121                                        |
| `submitContinuousWorksitePlan`     | Einreichen zur Prüfung (eigener Zustand, kein Publish)                                                                                                                          | EYT-123                                        |
| `publishPlan`                      | Veröffentlichung der Wochenrevision — **Bestandscommand**, um die Tagesvollständigkeit erweitert (§9)                                                                           | Slice 1 (Erweiterung), EYT-123 (Zeitraumsicht) |

**Override-/Abweichungsnachweis.** Kein gepflegtes Flag, sondern eine **Ableitung**: die
Konfigurationsrevision trägt `applied_default_snapshot_id` (nullable, EYT-120) und
`default_applied_at`; „abweichend" heißt, der aktuelle Tagesstand unterscheidet sich vom
Snapshot, gegen den er zuletzt erzeugt oder angewendet wurde. Ein Flag wäre eine zweite
Wahrheit, die bei jedem Direktedit nachgepflegt werden müsste und still veraltet. Konsequenz für
EYT-122: die Vorschau vergleicht Ist gegen Snapshot, sie liest kein Kennzeichen.

**Default ist Generator, keine Live-Vererbung** (bindend aus 9306113 §2): `generateWorksiteDays`
und `applyDefaultToDays` **materialisieren** in Tageskonfigurationen; eine spätere
Vorlagenänderung wirkt nie rückwirkend. Der Snapshot existiert, damit die Vorschau erklärbar
bleibt, ohne die Vorlage selbst zur Planungswahrheit zu machen.

## A.5 Audit-, Event- und Idempotenzgrenzen

- **Audit:** je Command genau ein `audit_events`-Eintrag in derselben Transaktion;
  `subject_type` = `worksite_day_configuration` bzw. `plan_version`; Kontext trägt **nur Ids und
  Codes** (gemessener Bestandsmaßstab, §0).
- **Outbox:** je Command eine Nachricht mit `idempotency_key`; Payload minimal (Ids).
- **Idempotenz:** je Command eine eigene `operation` (kein geteilter Schlüsselraum, 0012); das
  Ergebnis des ersten Aufrufs wird **unveränderlich gespeichert** (B.5, R-21). Für Serienbefehle
  (EYT-120/122) gilt dasselbe: das gespeicherte Ergebnis trägt die erzeugten bzw. berührten
  `worksiteDayIds` und Konfigurations-Ids, damit ein Retry exakt dieselbe Antwort erhält.
- **Ereignisse:** `planning.worksite_day_planned`, `planning.worksite_day_team_updated`, später
  `planning.worksite_days_generated`, `planning.default_applied`, `planning.plan_submitted` —
  additiv, keine Umbenennung.

## A.6 Kostenquelle

Bindend: Plan-Kosten entstehen ausschließlich aus **veröffentlichten konkreten Assignments**
(9306113 §4.5). Weder Identität noch Konfiguration noch Vorlage sind Kostenquelle.
Kosten-Snapshots referenzieren `assignment_id`/`plan_version_id` als Werte ohne FK (Bestand) und
bleiben historisch stabil. Der Kostenpfad wird in keinem Ticket dieser Architektur angefasst;
ein späteres „Kosten je Baustellentag" ist eine **Gruppierung über
`worksite_day_configuration_id`** bereits veröffentlichter Assignments — keine neue Quelle.

## A.7 Erweiterungsweg Tätigkeiten und Ressourcen

Beides ist heute **ohne Command und ohne Tabelle** (Tätigkeiten am Stammobjekt = EYT-16;
Ressourcen fehlen ganz). Der Weg ist festgelegt, damit später niemand improvisiert:

- Tätigkeiten eines Tages: `worksite_day_activities (worksite_day_configuration_id, activity_id)`
  — an der **Konfigurationsrevision**, weil sie je Revision abweichen.
- Ressourcen: eigene Stammdaten (`resources`) plus
  `worksite_day_resources (worksite_day_configuration_id, resource_id)`; exklusive Ressourcen
  erhalten eine EXCLUDE-Regel analog `assignments_no_published_overlap`, **auf veröffentlichte
  Zeilen beschränkt**.
- Beide erben Publish-Unveränderlichkeit und Kopiersemantik automatisch, weil sie an der
  Konfiguration hängen — der Grund, diese Ebene überhaupt zu führen.

## A.8 Vertrags- und Fehlercodegrenze (Zod/OpenAPI)

Alle neuen Objekte reisen als eigene DTOs; Domainklassen bleiben draußen (ADR-001/EYT-47).
Fehlercodes der Zielarchitektur, als RFC-7807-`type` im `PLANNING_ERROR_TYPE`-Katalog:

| Code                              | Bedeutung                                                                                                                                  | Slice   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `WORKSITE_DAY_NOT_FOUND`          | Tagesidentität oder Draft-Konfiguration nicht auflösbar (fremd == inexistent)                                                              | 1       |
| `STALE_WORKSITE_DAY`              | `expectedLockVersion` ≠ Serverstand                                                                                                        | 1       |
| `DUPLICATE_WORKSITE_DAY`          | Tageskonfiguration existiert in dieser Version bereits                                                                                     | 1       |
| `INTERVAL_OUTSIDE_DAY`            | Intervall gehört nicht zum lokalen Tag der Konfiguration                                                                                   | 1       |
| `WORKSITE_DAY_TEAM_REQUIRED`      | Command mit leerem Ziel-Team (B.6)                                                                                                         | 1       |
| `WORKSITE_DAY_INCOMPLETE`         | Publish-Riegel: Version enthält eine Tageskonfiguration ohne Zuweisung — Tiefenverteidigung, **kein** Konfliktcode im Transport-Enum (B.6) | 1       |
| `IDEMPOTENCY_KEY_REUSED`          | gleicher Schlüssel, anderer Payload                                                                                                        | Bestand |
| `WORKSITE_DAY_STATUS_NOT_ALLOWED` | Statuswechsel auf einer veröffentlichten oder nicht auflösbaren Konfiguration                                                              | EYT-121 |
| `DEFAULT_SNAPSHOT_STALE`          | Serienanwendung gegen veralteten Snapshot                                                                                                  | EYT-122 |
| `DAY_MANUALLY_CHANGED`            | Zieltag ist abweichend und nicht zum Überschreiben freigegeben                                                                             | EYT-122 |
| `PLAN_NOT_SUBMITTABLE`            | Einreichen bei offenen Pflichtangaben                                                                                                      | EYT-123 |

## A.9 Realisierungsstufen (welche Migration wann)

| Stufe    | Inhalt                                                                                                                                                                                                                                                                                  | Ticket                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **0019** | `worksite_days`, `worksite_day_configurations`, `assignments.worksite_day_configuration_id`, `idempotency_records.result_payload`, `app.remove_assignment_from_worksite_day`, Guards                                                                                                    | **Slice 1 (EYT-147)**      |
| 0020     | `continuous_worksite_plans`; `worksite_days.continuous_worksite_plan_id` (nullable); `worksite_default_configurations`; `worksite_default_snapshots`; `worksite_day_configurations.applied_default_snapshot_id` + `default_applied_at` (der Generator setzt beide beim Materialisieren) | EYT-120                    |
| 0021     | Konfigurationsfelder: Status `arbeitsfrei/ausgesetzt/abgesagt`, Hinweise — plus `setWorksiteDayStatus` (A.4), der den in B.6 benannten Ausgang liefert                                                                                                                                  | EYT-121                    |
| 0022     | Audit-/Idempotenzfelder der Serienanwendung                                                                                                                                                                                                                                             | EYT-122                    |
| 0023     | Einreichzustand am Zeitraum                                                                                                                                                                                                                                                             | EYT-123                    |
| später   | `worksite_day_activities`, `resources`, `worksite_day_resources`                                                                                                                                                                                                                        | EYT-16 / Ressourcen-Ticket |

Jede Stufe ist **expandierend**; keine Stufe ändert veröffentlichte Zeilen.

---

# TEIL B — IMPLEMENTIERUNGSSLICE EYT-147 (kleinste kompatible Untermenge)

## B.0 Was der Slice realisiert — und was ausdrücklich nicht

**Realisiert:** existierende Baustelle wählen; **ein** lokaler Baustellentag mit stabiler
Identität; Team mit **individuellen** Intervallen; atomare, idempotente Teamänderung; Readback
des bestätigten Serverstands; Publish- und Kostenkompatibilität; Vollständigkeitsregel beim
Publish.

**Nicht realisiert (DEFERRED, in Teil A entschieden):** Zeitraum/`ContinuousWorksitePlan`,
Default-Konfiguration und -Snapshot, Generator, Serienanwendung und Vorschau, Tagesstatus
`arbeitsfrei/ausgesetzt/abgesagt`, Tätigkeiten, Ressourcen, Einreichen-Workflow,
Worksite-Stammdatenanlage (EYT-16), Tag-Löschen, Tag-Adoption für Altzeilen,
`/einsatz/*`-Implementierung, Stilllegung von `createAssignment`.

## B.1 IST-Stand, auf dem der Slice aufsetzt

- **Schema [S]:** `worksites` (schmal, EYT-16-Grenze), `plan_versions` (ein Entwurf je Woche,
  `published_at` autoritativ), `assignments` (tenantgebundene FKs, generierte `during '[)'`,
  abgeleiteter `published_at`-Spiegel), `idempotency_records` (insert-only,
  `unique (org_id, operation, idempotency_key)`), `cost_snapshots`/`…_positions` (Herkunft als
  Wert ohne FK).
- **Invarianten [S]:** EXCLUDE auf veröffentlichte Überlappungen; Publish-Spiegel per
  security-definer-Trigger; `reject_published_row_change` (generisch, `23514`);
  `reject_assignment_in_published_plan` (definer seit 0015/0016, FOR SHARE).
- **Grant-Endstand 0017 [S]**, bewacht durch `supabase/tests/0012_planning_data_api_boundary.sql`
  (A1: kein UPDATE auf irgendeiner Spalte; A2: kein DELETE-Tabellenrecht; B1: **genau eine**
  Schreibpolicy (INSERT); C2/C3: UPDATE/DELETE werden abgewiesen):

  | Tabelle         | insert                                                                                                      | update                                                                                   | delete                        |
  | --------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------- |
  | `plan_versions` | `(org_id, week_key)`; Kanal + `planning.write` + `published_at is null`                                     | `(published_at, published_by)`; Kanal + `planning.publish` + `published_by = auth.uid()` | entzogen, Policy gelöscht     |
  | `assignments`   | `(org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)`; Kanal + `planning.write` | **entzogen, Policy gelöscht**                                                            | **entzogen, Policy gelöscht** |

- **API [A, tragende SQL S]:** `createAssignment` (Wochenprüfung in TypeScript → Idempotenz →
  Auswählbarkeit → Advisory-Lock → Entwurf holen-oder-anlegen → **Kopie der letzten
  veröffentlichten Version, wenn selbst angelegt** → SQL-Überlappungscheck → Insert → Audit +
  Outbox + Idempotenzrecord); `publishPlan` (FOR UPDATE auf die Wochenversionen →
  `expectedVersionId`-Stale-Check → `blockierendeKonflikte` → ein UPDATE auf `plan_versions`).
  Wirksame Konfliktregel: **nur** `EMPLOYEE_INTERVAL_OVERLAP`.
- **Web (b7917ab) [A, Fragmente S]:** Karte je Assignment, dummes Formular, Gateway und
  Vorgangsschlüssel in `PlanningWindowView.speichern`, modellagnostische Inspector-Mechanik.
- **`TenantQueryRunner` [R]:** committet bei normalem Return, rollt nur bei Exception zurück.

## B.2 Migration `<timestamp>_0019_worksite_days.sql` — **NUR PLAN, nicht ausgeführt**

Append-only, expandierend, kein Backfill, keine Änderung bestehender Zeilen.

```sql
-- 1. IDENTITÄT: eine Zeile je (Organisation, Baustelle, lokaler Tag). Keine Planungsdaten,
--    keine Zeiten, kein Publish-Marker, versionsübergreifend stabil (R-01).
create table public.worksite_days (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  worksite_id uuid not null,
  local_date date not null,                 -- lokaler Geschäftstag in der Zone der Organisation
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  -- Die Identitätsgarantie: derselbe reale Baustellentag ist immer dieselbe Zeile (I-4).
  unique (org_id, worksite_id, local_date),
  foreign key (worksite_id, org_id) references public.worksites (id, org_id) on delete restrict
);
-- EYT-120 ergänzt hier additiv: continuous_worksite_plan_id uuid null (A.1.1).

-- 2. REVISION: der Planungsstand dieses Tages in genau einer Planversion.
create table public.worksite_day_configurations (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  worksite_day_id uuid not null,
  plan_version_id uuid not null,
  -- Nebenläufigkeits-Token der TAGESIDENTITÄT, je Revision materialisiert und beim Kopieren
  -- übernommen (A.3). KEINE Zeiten, KEIN published_at.
  lock_version integer not null default 0 check (lock_version >= 0),
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  unique (plan_version_id, worksite_day_id),                     -- I-3
  foreign key (worksite_day_id, org_id) references public.worksite_days (id, org_id),
  foreign key (plan_version_id, org_id)
    references public.plan_versions (id, org_id) on delete cascade
);
create index worksite_day_configurations_version_idx
  on public.worksite_day_configurations (plan_version_id);
create index worksite_day_configurations_day_idx
  on public.worksite_day_configurations (worksite_day_id);

-- 3. RLS + Grants nach dem 0017-Muster (Spalten-Grants; Kanal und Recht in der Policy)
revoke all on table public.worksite_days, public.worksite_day_configurations
  from anon, authenticated;
grant select on table public.worksite_days, public.worksite_day_configurations to authenticated;
grant insert (org_id, worksite_id, local_date) on table public.worksite_days to authenticated;
grant insert (org_id, worksite_day_id, plan_version_id, lock_version)
  on table public.worksite_day_configurations to authenticated;
grant update (lock_version) on table public.worksite_day_configurations to authenticated;
-- KEIN delete-Grant auf beiden Tabellen (kein Lösch-Command im Slice; fail closed).
alter table public.worksite_days enable row level security;
alter table public.worksite_days force row level security;
alter table public.worksite_day_configurations enable row level security;
alter table public.worksite_day_configurations force row level security;
-- Policies je Tabelle:
--   select : org_id in (select app.user_org_ids())
--   insert : app.is_runtime_channel() and org_id in (select app.user_org_ids())
--            and app.has_permission(org_id, 'planning.write')
--   update (nur configurations, nur lock_version): dieselbe Bedingung; den Entwurfszustand
--            prüft der Trigger in 4b — dieselbe Arbeitsteilung wie beim assignments-INSERT.

-- 4a. Aufnahme-Guard: eine veröffentlichte Version nimmt keine Konfiguration mehr auf.
--     Wiederverwendung der generischen 0016-Fassung: sie liest ausschließlich
--     new.plan_version_id / new.org_id.
create trigger worksite_day_configurations_reject_published_plan
  before insert or update of plan_version_id on public.worksite_day_configurations
  for each row execute function app.reject_assignment_in_published_plan();

-- 4b. Unveränderlichkeit OHNE lokalen Marker: der Versionszustand wird gelesen.
--     ZWINGEND security definer — gemessene 0015-Lektion (CI-Lauf 30862744360): ein
--     INVOKER-`for share` prüft zusätzlich die USING-Klausel der UPDATE-Policy von
--     plan_versions, und die verlangt planning.publish. Eine Sitzung mit nur planning.write
--     (das Recht dieser Tabellen) fände die veröffentlichte Elternzeile NICHT,
--     v_published_at bliebe NULL und der Guard ließe die Mutation still durch.
create function app.reject_worksite_day_configuration_change_in_published_plan()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_published_at timestamptz;
begin
  select pv.published_at into v_published_at
    from public.plan_versions pv
   where pv.id = old.plan_version_id and pv.org_id = old.org_id
     and (auth.uid() is null or pv.org_id in (select app.user_org_ids()))   -- 0016-F2-Muster
     for share;
  if not found then
    -- Review-MESSUNG (PostgreSQL 17.6, lokaler Stack, Transaktion zurückgerollt): bei einer
    -- Löschkaskade ist die Elternzeile im BEFORE-DELETE des Kindes BEREITS entfernt und für
    -- dieses `for share` unsichtbar — „nicht gefunden" ist dort der NORMALFALL. Eine
    -- fail-closed-Variante machte gemessen schon das Löschen eines UNVERÖFFENTLICHTEN
    -- Entwurfs mit Tageskonfiguration unmöglich (`ERROR … CONTEXT: SQL statement "DELETE FROM
    -- ONLY … WHERE $1 = parent_id"`) und hätte die Aufräumpfade der Bestandssuiten
    -- (planning-write/-publish/-published-reads, costs/snapshot-http) gebrochen.
    -- Deshalb hier dasselbe Muster wie 0016: die Entscheidung gehört dem Fremdschlüssel und
    -- der Kaskade, nicht dieser Regel. Die Unveränderlichkeit VERÖFFENTLICHTER Zeilen bleibt
    -- gewahrt, weil eine veröffentlichte `plan_versions`-Zeile nach 0010 selbst unlöschbar ist
    -- und ihre Kaskade damit nie anläuft.
    -- Fail-Open NUR fuer DELETE (Review-Befund): bei UPDATE kann es per Konstruktion keine
    -- Kaskade geben (kein `on update cascade`), der FK garantiert die Elternzeile, und ein
    -- `not found` stammt dann ausschliesslich aus dem Sichtbarkeitsfilter — also aus einer
    -- Sitzung mit org-fremder Identitaet. Dort waere ein stiller Durchlass ein Fail-Open.
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'Planversion der Tageskonfiguration nicht aufloesbar' using errcode = '23514';
  end if;
  if v_published_at is not null then
    raise exception 'Tageskonfiguration einer veroeffentlichten Planversion ist unveraenderlich'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function app.reject_worksite_day_configuration_change_in_published_plan()
  from public;
create trigger worksite_day_configurations_immutable_when_published
  before update or delete on public.worksite_day_configurations
  for each row
  execute function app.reject_worksite_day_configuration_change_in_published_plan();

-- 5. Assignments: Unterordnung unter die REVISION (R-26), nullable für Bestandszeilen
alter table public.assignments add column worksite_day_configuration_id uuid;
alter table public.assignments add constraint assignments_worksite_day_configuration_fk
  foreign key (worksite_day_configuration_id, org_id)
  references public.worksite_day_configurations (id, org_id);
  -- NO ACTION (Default). Review-MESSUNG (PostgreSQL 17.6, Replika dieser Topologie): RESTRICT
  -- verhielte sich hier identisch; der einzige dokumentierte Unterschied ist Deferrierbarkeit.
create index assignments_worksite_day_configuration_idx
  on public.assignments (worksite_day_configuration_id);

revoke insert on table public.assignments from authenticated;
grant insert (org_id, plan_version_id, worksite_day_configuration_id, employee_id, worksite_id,
              starts_at_utc, ends_at_utc)
  on table public.assignments to authenticated;
-- 0012-WÄCHTER: KEIN update-, KEIN delete-Grant, KEINE zweite Schreibpolicy auf assignments.
-- A1/A2/B1/C2/C3 bleiben unverändert gültig und laufen in M1 erneut (R-13, Test K).

-- 5b. Strukturelle Zugehörigkeit (I-1): Baustelle und Planversion der Zuweisung stimmen mit
--     denen ihrer Tageskonfiguration überein.
create function app.assignment_belongs_to_worksite_day_configuration()
returns trigger language plpgsql set search_path = '' as $$
declare v_worksite_id uuid; v_plan_version_id uuid;
begin
  if new.worksite_day_configuration_id is null then return new; end if;   -- Legacy-/Alt-Pfad
  select d.worksite_id, c.plan_version_id into v_worksite_id, v_plan_version_id
    from public.worksite_day_configurations c
    join public.worksite_days d on d.id = c.worksite_day_id and d.org_id = c.org_id
   where c.id = new.worksite_day_configuration_id and c.org_id = new.org_id;
  if not found then return new; end if;     -- Existenz/Sichtbarkeit gehört dem FK (23503)
  if v_worksite_id <> new.worksite_id or v_plan_version_id <> new.plan_version_id then
    raise exception 'Zuweisung widerspricht Baustelle oder Planversion ihrer Tageskonfiguration'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger assignments_belong_to_worksite_day_configuration
  before insert or update on public.assignments
  for each row execute function app.assignment_belongs_to_worksite_day_configuration();
  -- Der Publish-Spiegel (update published_at, definer) passiert: Tagdaten unverändert.

-- 6. FACHLICH GEBUNDENE Entfernen-Grenze (R-13/R-23) — kein allgemeiner Assignment-DELETE.
create function app.remove_assignment_from_worksite_day(
  p_assignment_id uuid,
  p_worksite_day_configuration_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_a record; v_c record; v_published_at timestamptz;
begin
  if not app.is_runtime_channel() then
    raise exception 'Nur der Laufzeitkanal darf Zuweisungen aus einem Baustellentag entfernen'
      using errcode = '42501';
  end if;
  -- ACHTUNG: unter definer ist dieser Select NICHT RLS-gefiltert; die einzige Mandantengrenze
  -- ist der explizite org-Check. Praezedenz fuer definer + `app.user_org_ids()` im Rumpf:
  -- app.reject_assignment_in_published_plan (0015/0016). Fuer `app.has_permission` im Rumpf
  -- einer ANDEREN definer-Funktion gibt es KEINE Praezedenz (gemessen: im Schema `app` ruft
  -- heute keine Funktion sie auf) — die Annahme steht deshalb in §15 und wird in M3/M4
  -- gemessen. Von app.lock_employee_planning (0012, INVOKER) stammt nur: die Organisation
  -- kommt aus der Zeile, nie aus einem Parameter.
  select a.org_id, a.plan_version_id, a.published_at, a.worksite_day_configuration_id
    into v_a from public.assignments a where a.id = p_assignment_id;
  select c.org_id, c.plan_version_id
    into v_c from public.worksite_day_configurations c
   where c.id = p_worksite_day_configuration_id;

  -- Fremd und inexistent sind nach außen ununterscheidbar: EIN Fehler, EIN Wortlaut.
  if v_a is null or v_c is null
     or v_a.org_id not in (select app.user_org_ids())
     or v_c.org_id <> v_a.org_id
     or v_a.worksite_day_configuration_id is distinct from p_worksite_day_configuration_id
     or v_a.plan_version_id <> v_c.plan_version_id then
    raise exception 'Zuweisung gehoert nicht zu dieser Tageskonfiguration' using errcode = 'P0002';
  end if;
  if not app.has_permission(v_a.org_id, 'planning.write') then
    raise exception 'Kein Planungsrecht' using errcode = '42501';
  end if;

  select pv.published_at into v_published_at
    from public.plan_versions pv
   where pv.id = v_a.plan_version_id and pv.org_id = v_a.org_id
     for share;                                    -- Race gegen einen laufenden Publish
  if not found then
    -- Konsistent mit Block 4b: hier ist KEINE Kaskade im Spiel (die Funktion wird direkt
    -- aufgerufen, nicht aus einem Trigger), die Elternzeile existiert per FK, und ein
    -- stummer Durchlass wäre ein Loch in genau der Grenze, die diese Funktion ist.
    raise exception 'Planversion der Zuweisung nicht aufloesbar' using errcode = '23514';
  end if;
  if v_published_at is not null or v_a.published_at is not null then
    raise exception 'Veroeffentlichte Zuweisung kann nicht entfernt werden' using errcode = '23514';
  end if;

  delete from public.assignments where id = p_assignment_id;
  -- Zweiter Riegel bleibt scharf: assignments_published_immutable (0010) feuert auch für den
  -- definer/Owner und lehnte eine veröffentlichte Zeile zusätzlich mit 23514 ab.
end $$;
revoke all on function app.remove_assignment_from_worksite_day(uuid, uuid) from public;
grant execute on function app.remove_assignment_from_worksite_day(uuid, uuid) to authenticated;

-- 7. Idempotenz: unveränderliches Ergebnis des ERSTEN Aufrufs (R-21, Finding 3)
alter table public.idempotency_records add column result_payload jsonb;
alter table public.idempotency_records
  add constraint idempotency_records_result_payload_is_object
  check (result_payload is null or jsonb_typeof(result_payload) = 'object');
-- Pflicht fuer die neuen Operationen in der DB, nicht nur im Test (Review-Befund): ein
-- Payload-loser Insert ist damit 23514 statt eines stillen Zustands, in dem der Replay
-- weder die erste Antwort reproduzieren noch ehrlich scheitern koennte.
alter table public.idempotency_records
  add constraint idempotency_records_worksite_day_ops_need_payload -- 49 Byte < NAMEDATALEN-1
  check (
    operation not in ('planning.plan_worksite_day', 'planning.update_worksite_day_team')
    or result_payload is not null
  );
-- Kanalpruefung nachziehen (Review-Befund): bis heute prueft die INSERT-Policy nur die
-- Organisation — 0017 liess das stehen, weil kein Verbraucher davon profitierte. Mit
-- result_payload speist diese Spalte den Antwortkoerper eines Commands; ohne Kanalriegel
-- koennte jede authenticated-Sitzung mit Org-Mitgliedschaft ueber die Data-API ein
-- Replay-Ergebnis vorschreiben. Additiv, kein Grantwechsel — aber
-- OPERATIONSGEBUNDEN, nicht pauschal (Review-MESSUNG): es gibt VIER Schreiber von
-- idempotency_records — planning.create_assignment, planning.publish_plan,
-- costs.create_rate_version und costs.create_cost_snapshot. `costs.create_rate_version`
-- schreibt `employee_rate_versions`, die selbst KEINEN Laufzeitkanal verlangt, und seine
-- Integrationssuite laeuft ueber eine `postgres`-Sitzung. Eine pauschale Kanalpflicht liesse
-- diesen Bestandspfad an RLS scheitern (gemessen: derselbe Insert gelingt mit der
-- Bestands-Policy und scheitert mit der pauschalen Fassung). Den Kanal braucht nur, wer ein
-- `result_payload` schreibt — also genau die beiden neuen Vorgaenge.
drop policy idempotency_records_insert_in_org on public.idempotency_records;
create policy idempotency_records_insert_in_org on public.idempotency_records
  for insert to authenticated
  with check (
    org_id in (select app.user_org_ids())
    and (result_payload is null or app.is_runtime_channel())
  );

-- LESEGRENZE (R5-1). RLS filtert ZEILEN, nicht Spalten: eine Policy-Bedingung koennte den
-- Payload nur verbergen, indem sie die ganze Zeile verschwinden laesst — und selbst dann
-- bliebe er fuer jede Sitzung lesbar, die die Zeilenbedingung erfuellt. Der Payload traegt
-- historische Command-Evidenz (Team, Personen, Intervalle eines Draft-Standes, der spaeter
-- geaendert oder entfernt worden sein kann) und 0012 kennt keine Aufbewahrungsregel.
-- Deshalb ein SPALTENRECHT statt einer Zeilenbedingung — dasselbe Muster, mit dem 0010/0017
-- die assignments-Schreibrechte begrenzt haben, nur fuer SELECT:
revoke select on table public.idempotency_records from authenticated;
grant select (id, org_id, operation, idempotency_key, subject_id, request_fingerprint,
              created_at)
  on table public.idempotency_records to authenticated;
-- `result_payload` ist damit fuer `authenticated` auf KEINEM direkten Weg lesbar — weder
-- ueber die PostgREST-Data-API noch ueber eine rohe Abfrage im Laufzeitkanal. Die
-- SELECT-Policy bleibt woertlich unveraendert (org-weit): der einzige Bestandsleser liest
-- `subject_id, request_fingerprint` (pg-idempotency-store.ts:26-28, gemessen: kein `select *`
-- im Repository), und beide Spalten stehen weiter im Grant. Alle vier Bestandsvorgaenge
-- bleiben damit unberuehrt.

-- Die EINZIGE Lesestelle des Payloads: command- und kanalgebundene definer-Funktion.
create function app.read_idempotency_result(p_operation text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = '' as $$
declare v_org uuid; v_payload jsonb; v_orgs uuid[];
begin
  -- 1. Nur die beiden Payload-Vorgaenge. Ein anderer Operationsname kommt hier nie an;
  --    kaeme er doch, ist das ein Aufruferfehler und kein Leseweg.
  if p_operation not in ('planning.plan_worksite_day', 'planning.update_worksite_day_team') then
    raise exception 'Kein Payload-Vorgang' using errcode = '42501';
  end if;
  -- 2. Laufzeitkanal.
  if not app.is_runtime_channel() then
    raise exception 'Nur der Laufzeitkanal darf ein Replay-Ergebnis lesen' using errcode = '42501';
  end if;
  -- 3. ORGANISATION ZUERST, deterministisch und aus dem authentisierten Kontext (F1).
  --    Unter `security definer` gibt es KEINE RLS-Filterung — die Mandantengrenze muss die
  --    Funktion selbst ziehen, und zwar BEVOR sie eine Zeile auswaehlt. Der Unique-Schluessel
  --    von 0012 ist `(org_id, operation, idempotency_key)`, NICHT `(operation, key)`: zwei
  --    Organisationen duerfen denselben Vorgangsnamen und denselben Schluessel fuehren. Die
  --    Revision-5-Fassung waehlte die Zeile deshalb VOR der Mandantenbindung aus und pruefte
  --    die Zugehoerigkeit erst danach (`if not found or v_org not in (…) then return null`).
  --    Gemessen am lokalen Stack (zwei Organisationen, gleicher Vorgang, gleicher Schluessel):
  --    der ungebundene Select liefert `found=t` mit der FREMDEN Zeile (`payload={"org":"A"}`
  --    bei einer B-Abfrage). Der Nachfilter verwarf sie dann — der Aufrufer bekam also einen
  --    Replay-MISS statt seiner Erstantwort, und bei mehrdeutigem Mitgliedschaftskontext gab
  --    es zusaetzlich keine eindeutige Organisationswahl. Revision 6 beseitigt diese
  --    Fehlerklasse an der Wurzel: Aufloesung VOR dem Select, Bindung IN der Abfrage.
  --
  --    Die Regel ist dieselbe wie im Planning-Command: GENAU EINE aktive Organisation, sonst
  --    fail-closed (`NO_ORGANISATION` / `AMBIGUOUS_ORGANISATION`, planning-writes.port.ts:35/37;
  --    dort aufgeloest ueber `select id, time_zone from public.organizations`). KEIN
  --    `order by … limit 1` — eine Auswahl unter mehreren Mitgliedschaften waere geraten.
  --    `v_orgs[1]` ist hier keine Auswahl, sondern die Identitaet: der Zugriff erfolgt erst,
  --    nachdem genau ein Element festgestellt wurde. Ein Statement, ein Funktionsaufruf.
  --    (`min(o)` waere die naheliegende Kurzform und ist NICHT verwendbar: PostgreSQL kennt
  --    kein `min(uuid)` — gemessen am lokalen Stack: `ERROR: function min(uuid) does not
  --    exist`. `array_agg` ueber `setof uuid` ist gemessen: leere Menge -> NULL,
  --    eine Zeile -> `array_length = 1`, zwei Zeilen -> 2.)
  --
  --    `into strict` waere die kuerzere Schreibweise, ist hier aber bewusst NICHT gewaehlt:
  --    sie wirft NO_DATA_FOUND = `P0002`, und diesen Code fuehrt
  --    `app.remove_assignment_from_worksite_day` in dieser Migration bereits mit einer anderen
  --    Bedeutung. Zwei Bedeutungen fuer einen SQLSTATE waeren an einer Sicherheitsgrenze eine
  --    vermeidbare Mehrdeutigkeit.
  --
  --    ROLLENVERTEILUNG: die Anwendung hat die Eindeutigkeit bereits in B.7 Schritt 1 geprueft
  --    (vor der Idempotenz in Schritt 2) und dort `NO_ORGANISATION`/`AMBIGUOUS_ORGANISATION`
  --    beantwortet. Dieser Riegel ist Tiefenverteidigung: loest er aus, ist eine Invariante
  --    verletzt, kein regulaerer Fachfall — deshalb genuegt hier ein einheitliches `42501`.
  select array_agg(o) into v_orgs from app.user_org_ids() as o;
  if v_orgs is null then
    raise exception 'Keine aktive Organisation' using errcode = '42501';
  end if;
  if array_length(v_orgs, 1) > 1 then
    raise exception 'Mehrdeutige Organisation — genau eine aktive Mitgliedschaft erforderlich'
      using errcode = '42501';
  end if;
  v_org := v_orgs[1];

  -- 4. Recht auf der aufgeloesten Organisation. Vor der Payload-Abfrage, damit ein fehlendes
  --    Recht nichts ueber die Existenz eines Schluessels verraet.
  if not app.has_permission(v_org, 'planning.write') then
    raise exception 'Kein Planungsrecht' using errcode = '42501';
  end if;

  -- 5. Erst jetzt die Zeile — mandantengebunden ueber den vollstaendigen Unique-Schluessel.
  select result_payload into v_payload
    from public.idempotency_records
   where org_id = v_org
     and operation = p_operation
     and idempotency_key = p_key;
  -- 6. Fremder Schluessel und nicht vorhandener Schluessel sind nach aussen identisch: beides
  --    `null`, also "kein Replay" — kein Fehler, der eine fremde Existenz verraet.
  if not found then
    return null;
  end if;
  return v_payload;
end $$;
revoke all on function app.read_idempotency_result(text, text) from public;
grant execute on function app.read_idempotency_result(text, text) to authenticated;
-- app.has_permission(uuid, text) ist dafuer exakt verwendbar — stable, security definer,
-- search_path = '', an authenticated gegrantet, und bereits die tragende Bedingung der
-- assignments-INSERT-Policy (0017); 'planning.write' ist in role_permissions fuer owner und
-- manager vergeben (0015).
comment on column public.idempotency_records.result_payload is
  'Unveraenderliche Antwort des ERSTEN Aufrufs (EYT-147). Nullable fuer Bestandsvorgaenge, die
   ihr Ergebnis ueber subject_id zurueckliesen. Inhalt: ausschliesslich Ids, Zeitstempel und
   Zahlen — niemals Labels oder Namen. ABER ausdruecklich NICHT derselbe Massstab wie
   audit_events.context: dies ist historische Command-Evidenz und haelt Personen- und
   Intervallzuordnungen fest, die aus dem aktuellen Draft spaeter entfernt worden sein koennen.
   Deshalb steht diese Spalte NICHT im SELECT-Grant und ist ausschliesslich ueber
   app.read_idempotency_result lesbar: nur die beiden Payload-Vorgaenge, nur im Laufzeitkanal,
   nur mit planning.write UND nur gebunden an die genau eine aktive Organisation der
   aufrufenden Identitaet, die die Funktion vor der Zeilenauswahl aufloest — und deshalb
   insert-only.';
-- 8. KLASSE-(2)-ERWERB ALS DOMAIN-FUNKTION (F2). Der Helfer `entwurfSicherstellen` ruft
--    ausschliesslich diese Funktion; es gibt keine zweite Draft-Aufloesung.
--
--    WARUM NICHT im Anwendungscode mit einem einfachen `select … for share`: gemessen am
--    lokalen Stack (PostgreSQL 17.6, Laufzeitkanal, Recht `planning.publish` entzogen):
--        A) INVOKER  `… where week_key=… and published_at is null for share`  -> KEINE ZEILE
--        B) DEFINER  dieselbe Abfrage                                         -> Zeile gefunden
--    Ursache ist dieselbe, die 0015 fuer den Assignment-Guard dokumentiert: ein `for share`
--    prueft zusaetzlich die USING-Klausel der UPDATE-Policy von plan_versions, und die
--    verlangt `planning.publish`. Eine Sitzung mit nur `planning.write` — also der
--    Normalfall dieser drei Commands — faende die Draft-Zeile nicht und koennte die
--    Postcondition nicht erfuellen. Der Erwerb gehoert deshalb in eine definer-Funktion.
--
--    WARUM DIE SCHLEIFE: veroeffentlicht ein Publisher waehrend des Wartens, wertet
--    PostgreSQL die Qualifikation nach dem Commit erneut aus (EvalPlanQual);
--    `published_at is null` trifft nicht mehr zu und das Statement liefert 0 Zeilen.
--    Ohne Wiederholung stuende der Aufrufer ohne Draft da. Gemessen: nach dem Publish ist
--    der partielle Unique-Index frei, und derselbe Insert legt in der naechsten Runde den
--    Folgedraft an ('runde2: NEUER Draft angelegt', Endzustand 1 Entwurf + 1 veroeffentlicht).
--
--    WARUM DIE MANDANTENAUFLOESUNG VORNE STEHT (F3): unter `security definer` laeuft die
--    Funktion als Eigentuemer, und der traegt BYPASSRLS. Die Mengenform
--    `where org_id in (select app.user_org_ids())` ist hier deshalb KEINE Grenze, sondern
--    eine Auswahl. Gemessen an genau dieser Mengenform (PostgreSQL 17.6, isolierte Probe,
--    zurueckgerollt):
--        zwei Orgs, in keiner ein Entwurf  -> `query returned more than one row` (P0003);
--                                             `RETURNING … INTO` wirft das auch OHNE `strict`
--        Org A hat Entwurf, Org B nicht    -> legt STILL einen Entwurf in B an und gibt dessen
--                                             Id zurueck (gemessen; symmetrisch auch umgekehrt:
--                                             hat B den Entwurf, entsteht einer in A)
--        keine aktive Organisation         -> 0 Zeilen, 0 Zeilen, drei Runden, dann `55P03`
--    Der mittlere Fall ist der gefaehrliche: ein nach aussen ERFOLGREICHER Command im
--    falschen Mandanten. Deshalb loest die Funktion genau eine aktive Organisation auf,
--    VOR jedem Insert und jedem Select, und scheitert sonst fail-closed mit `42501` — nach
--    demselben Muster wie `app.read_idempotency_result` (F1, Block 7): kein Org-Parameter
--    (den duerfte der Client waehlen), kein `order by … limit 1` (das waere die willkuerliche
--    Auswahl unter anderem Namen).
create function app.lock_week_draft(p_week_key text)
returns uuid
language plpgsql
security definer
set search_path = '' as $$
declare v_id uuid; v_org uuid; v_orgs uuid[]; v_runde integer := 0;
begin
  if not app.is_runtime_channel() then
    raise exception 'Nur der Laufzeitkanal darf einen Wochenentwurf sperren' using errcode = '42501';
  end if;

  -- F3: Mandantengrenze zuerst, danach ist jeder Zugriff an `v_org` gebunden.
  select array_agg(o) into v_orgs from app.user_org_ids() as o;
  if v_orgs is null then
    raise exception 'Keine aktive Organisation' using errcode = '42501';
  end if;
  if array_length(v_orgs, 1) <> 1 then
    raise exception 'Mehrdeutige Organisation - genau eine aktive Mitgliedschaft erforderlich'
      using errcode = '42501';
  end if;
  v_org := v_orgs[1];

  if not app.has_permission(v_org, 'planning.write') then
    raise exception 'Kein Planungsrecht' using errcode = '42501';
  end if;

  loop
    v_runde := v_runde + 1;
    -- (a) Anlegen. Gewinnt diese Transaktion, haelt sie die Zeile ueber den eigenen,
    --     noch nicht committeten Insert; das reentrante `for share` in (b) ist dann ein
    --     No-op (gemessen: laeuft ohne Blockade durch). Die Existenz von `v_org` in
    --     `public.organizations` prueft weiterhin der Fremdschluessel von `plan_versions` —
    --     der Lesezugriff auf `organizations` entfaellt mit F3 ersatzlos.
    insert into public.plan_versions (org_id, week_key)
    values (v_org, p_week_key)
    on conflict do nothing
    returning id into v_id;
    if v_id is not null then return v_id; end if;

    -- (b) Bestehenden Entwurf sperren. `for share` konfligiert mit dem `for update` des
    --     Publishers (gemessen), nicht aber mit einem zweiten `for share` — zwei Planerinnen
    --     derselben Woche behindern einander nicht. `planning.write` ist oben auf `v_org`
    --     bereits geprueft; eine zweite Prueffung im Praedikat waere dieselbe Aussage.
    select pv.id into v_id
      from public.plan_versions pv
     where pv.org_id = v_org
       and pv.week_key = p_week_key
       and pv.published_at is null
       for share;
    if v_id is not null then return v_id; end if;

    -- (c) Weder angelegt noch gefunden: zwischen (a) und (b) wurde veroeffentlicht.
    --     Naechste Runde legt den Folgedraft an. Begrenzt, damit ein unerwarteter Zustand
    --     benannt scheitert statt zu kreisen.
    if v_runde >= 3 then
      raise exception 'Wochenentwurf nicht ermittelbar (% Runden)', v_runde using errcode = '55P03';
    end if;
  end loop;
end $$;
revoke all on function app.lock_week_draft(text) from public;
grant execute on function app.lock_week_draft(text) to authenticated;

-- Zum INSERT-Recht: 0012 vergab `grant select, insert` auf TABELLENebene. Fuer INSERT bleibt
-- das so (ein Tabellen-Grant deckt neue Spalten mit ab; M1 MISST es ueber
-- has_column_privilege, statt es anzunehmen); fuer SELECT ist das Tabellenrecht oben
-- ausdruecklich entzogen und spaltenweise neu vergeben. Weiterhin KEIN update, KEIN delete:
-- „ein Idempotenzergebnis, das sich aendern laesst, ist keins" (0012).
```

**Wechselwirkung mit dem Schema-Metagate.** `supabase/tests/0005_schema_meta_gate.sql` führt
`EXPECTED_TABLES` als einzige Tabellenaufzählung und geht per Konstruktion rot, sobald eine
unbekannte `public`-Tabelle existiert. M1 trägt **beide** neuen Tabellen dort ein — der einzige
zulässige Eingriff in eine Bestands-pgTAP-Datei.

## B.3 Zeitmodell und Invarianten

**Weder Identität noch Konfiguration trägt Zeiten.** Es gibt keine Invariante
`assignment.interval == worksite_day(.configuration).interval`; sie widerspräche 9306113 §4.2
(„mehrere Einsatzintervalle am selben Tag"). Zeiten leben ausschließlich in `assignments` — der
Quelle, an der EXCLUDE, Kosten-Tagesaufteilung und Employee-Vertrag bereits hängen. Ein
persistiertes „operatives Tagesfenster" wird **nicht** eingeführt; falls ein späteres Ticket
eines begründet, gilt **Containment** (`assignment.interval ⊆ Fenster`), niemals Gleichheit —
mit eigener Migration und eigenem Test. Der angezeigte Tageszeitraum ist eine **Ableitung**
(min(start) … max(end) der Team-Intervalle; das Team ist nach B.6 nie leer, der Zeitraum also
immer definiert — außer bei einer Datenanomalie, die der Lesepfad unverändert darstellt).

**Worksite vs. WorksiteDay.** `worksites` = Stammdatenobjekt (EYT-16-Grenze: Adresse und
Tätigkeiten folgen dort). `worksite_days` = Planungsidentität eines lokalen Tages. Der Slice
**wählt** eine existierende Baustelle; er legt keine an und ergänzt kein Stammdatenfeld (R-16).

| Invariante                                                                                       | Durchsetzung                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I-1 Zuweisung gehört zu Baustelle und Planversion ihrer Konfiguration                            | DB-Trigger `assignments_belong_to_worksite_day_configuration` + tenantgebundene FKs                                                                                                                    |
| I-2 `localBusinessDate(assignment.starts_at_utc, org.time_zone) == worksite_days.local_date`     | **applikationsseitig** in beiden Commands (`INTERVAL_OUTSIDE_DAY`) — dieselbe Stellung wie die bestehende Woche↔Zuweisung-Bindung (`week-membership.ts`, dort als SQL-CHECK-unerreichbar dokumentiert) |
| I-3 höchstens eine Konfiguration je (Planversion, Tagesidentität)                                | DB-Unique                                                                                                                                                                                              |
| I-4 Identität je (Organisation, Baustelle, Tag) eindeutig                                        | DB-Unique auf `worksite_days`                                                                                                                                                                          |
| I-5 keine überlappenden Zuweisungen je Person im selben Entwurf; veröffentlicht hart per EXCLUDE | bestehendes SQL (`during &&`) + 0010                                                                                                                                                                   |
| **bewusst KEINE** Invariante über Intervallgleichheit                                            | R-04, Test F                                                                                                                                                                                           |

## B.4 Nebenläufigkeit: Token, Ablauf, Sperrordnung (Findings 2 und 6)

### B.4.1 Token je Objekt (genau eine Stale-Wahrheit, R-20)

| Objekt                                   | Token                                      | Command                 | Ablehnung                                                       |
| ---------------------------------------- | ------------------------------------------ | ----------------------- | --------------------------------------------------------------- |
| Wochenrevision (`plan_versions`)         | `expectedVersionId` (Bestand)              | `publishPlan`           | 409 `STALE_VERSION` / `ALREADY_PUBLISHED`                       |
| Baustellentag (logisch, über Revisionen) | `lock_version` der **Draft**-Konfiguration | `updateWorksiteDayTeam` | 409 `STALE_WORKSITE_DAY { aktuelleLockVersion }`                |
| Tageskonfiguration anlegen               | Unique I-3                                 | `planWorksiteDay`       | 409 `DUPLICATE_WORKSITE_DAY { worksiteDayId, configurationId }` |

**CAS vor Delta.** Der Token-Bump ist die erste Mutation **am Tagesobjekt**:
`update worksite_day_configurations set lock_version = lock_version + 1 where id = $1 and
lock_version = $expected`. `rowCount = 0` ⇒ aktuellen Stand lesen ⇒ `STALE_WORKSITE_DAY`, bevor
irgendein Delete oder Insert läuft. Der vorgelagerte Schritt `entwurfSicherstellen` kann Zeilen
anlegen (Draft + Kopie); er ist durch den Exception-Rollback (B.7 Schritt 8) vollständig
abgedeckt — ein fehlgeschlagenes CAS hinterlässt keinen halben Draft.

### B.4.2 Veröffentlicht → Draft: der Ablauf, der nicht abbrechen darf (Finding 2)

Der Command trägt die **stabile** `worksiteDayId`, nie eine Konfigurations-Id.

1. Browser zeigt den veröffentlichten Baustellentag (`worksiteDayId` stabil, `configurationId`
   der veröffentlichten Revision, `lockVersion` z. B. 3).
2. Nutzer bearbeitet → Client sendet `{ worksiteDayId, expectedLockVersion: 3, team: […] }`.
3. `entwurfSicherstellen(tx, weekKey)`: Draft holen-oder-anlegen — und **mit gehaltenem
   Klasse-(2)-Lock zurückkehren** (harte Postcondition, B.4.3: `for share` in beiden Pfaden).
   **Nur** der Insert-Gewinner kopiert die letzte veröffentlichte Version — Konfigurationen
   (neue Id, **gleiche** `worksite_day_id`, **übernommener** `lock_version`) und Assignments
   (neue Id, remapped auf die neuen Konfigurations-Ids; `NULL` bleibt `NULL`).
4. Konfiguration auflösen: `select id, lock_version from worksite_day_configurations where
worksite_day_id = $1 and plan_version_id = <Draft>`. Existiert sie nicht (die Identität kam
   in keiner Version dieser Woche vor) → `WORKSITE_DAY_NOT_FOUND`; Anlegen ist
   `planWorksiteDay`.
5. CAS gegen `lock_version` der **Draft**-Konfiguration: 3 trifft 3 → Bump auf 4. Ein zweiter
   Client mit 3 träfe 4 → `STALE_WORKSITE_DAY`.
6. Mutation ausschließlich im Draft; die veröffentlichte Konfiguration und ihre Assignments
   bleiben unverändert (Guards, Test E).
7. Antwort: `{ worksiteDayId (stabil), configurationId (Draft-Revision), lockVersion, team }`.

Damit ist der von Finding 2 verbotene Ablauf ausgeschlossen: der Command sucht **nie** mit einer
versionsgebundenen Id, und die Auflösung über die stabile Identität findet die kopierte
Konfiguration. Bricht er dennoch ab — Schritt 4 (`WORKSITE_DAY_NOT_FOUND`, Identität kam in
dieser Woche nie vor) oder Schritt 5 (CAS) —, rollt die Transaktion **Draft und Kopie mit
zurück**; es bleibt kein halb erzeugter Entwurf stehen. Beide Abbrüche gehören zu den
Domänenkonflikten aus B.7 Schritt 8 und werden als interne Exception geworfen, nicht als
`ok:false` zurückgegeben.

### B.4.3 Vollständige Sperrordnung (R-24)

Ressourcenklassen (Klassenmenge und Reihenfolge unverändert gegenüber Revision 6; in Klasse (2)
entfällt der Zusatz „(Trigger)", weil `FOR SHARE` seit F2 auch **Erst**-Erwerb ist):

```
(1) Advisory: app.lock_idempotency_key(operation, key)
(2) plan_versions      — Insert-Unique / SELECT … FOR UPDATE (publish) / FOR SHARE
(3) worksite_days      — Insert-Unique (get-or-create)
(4) worksite_day_configurations — Insert-Unique / UPDATE (CAS)
(5) Advisory: app.lock_employee_planning(employeeId), aufsteigend nach employeeId sortiert
(6) assignments        — DELETE (nur über die definer-Funktion) und kollidierende INSERTs
```

**Klasse (6) ist nur dort ein Wartepunkt**, wo auf eine bestehende Zeile gewartet wird: beim
DELETE über die definer-Funktion und bei einem INSERT, der in einen Unique- oder
EXCLUDE-Konflikt läuft. Ein INSERT neuer, konfliktfreier Zeilen — etwa die Entwurfs-Kopie —
wartet auf nichts.

#### Harte Postcondition von `entwurfSicherstellen(tx, weekKey)` (F2)

> **Kehrt der Helfer erfolgreich zurück, hält DIESE Transaktion einen Klasse-(2)-Lock auf genau
> der zurückgegebenen Draft-Zeile, und dieser Lock besteht bis zum Transaktionsende.**

Erfüllt wird sie über **eine** Domain-Funktion, `app.lock_week_draft(weekKey)` (B.2 Block 8), die
der Helfer als einzige Draft-Auflösung aufruft. Zwei Messungen erzwingen genau diese Bauart:

| Versuchte Form                                                                                        | Gemessenes Ergebnis                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `select … where week_key = $1 and published_at is null **for share**` im **Anwendungscode** (Invoker) | **KEINE ZEILE**, sobald der Sitzung `planning.publish` fehlt — der Normalfall dieser Commands. Ein `for share` prüft zusätzlich die USING-Klausel der UPDATE-Policy von `plan_versions`, und die verlangt `planning.publish` (dieselbe Ursache, die 0015 für den Assignment-Guard dokumentiert). Die Postcondition wäre unerfüllbar |
| dieselbe Abfrage in einer **`security definer`**-Funktion                                             | Zeile gefunden — gemessen mit entzogenem `planning.publish`: Invoker `KEINE ZEILE`, Definer `40d0ec03-…`                                                                                                                                                                                                                            |

Und die Funktion **wiederholt**, statt aufzugeben: veröffentlicht ein Publisher während des
Wartens, wertet PostgreSQL die Qualifikation nach dem Commit erneut aus (EvalPlanQual),
`published_at is null` trifft nicht mehr zu, das Statement liefert 0 Zeilen. Gemessen: der
partielle Unique-Index ist dann frei, und derselbe Insert legt in der nächsten Runde den
**Folgedraft** an (Endzustand: ein Entwurf, eine veröffentlichte Version). Ohne diese Runde
stünde der Aufrufer ohne Draft da und die Transaktion bräche mit einem unbenannten Fehler ab.

| Pfad                    | Was bei Return gehalten wird                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Insert-Gewinner**     | die eigene, noch nicht committete Zeile; das reentrante `for share` derselben Transaktion läuft gemessen ohne Blockade                        |
| **Existierender Draft** | `FOR SHARE` auf der gefundenen Zeile — konfligiert mit dem `for update` des Publishers, nicht mit einem zweiten `for share` (beides gemessen) |
| **Publish dazwischen**  | nächste Runde legt den Folgedraft an und hält dessen Zeile                                                                                    |

#### Tatsächliche erste blockierende Akquisitionen

| Command                 | Erste blockierende Akquisition je Klasse                                    | Reentry                                                                                 | Aufsteigend? |
| ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| `createAssignment`      | (1) → (2) **in `entwurfSicherstellen` / `app.lock_week_draft`** → (5) → (6) | `for share` des Bestandstriggers `assignments_reject_published_plan` ist reiner Reentry | ✓            |
| `planWorksiteDay`       | (1) → (2) im Helfer → (3) → (4) → (5) → (6)                                 | Trigger 4a und Assignment-Trigger reentrant                                             | ✓            |
| `updateWorksiteDayTeam` | (1) → (2) im Helfer → (4 CAS) → (5) → (6)                                   | Trigger 4b, Entfernfunktion und Insert-Trigger reentrant                                | ✓            |
| `publishPlan`           | (1) → (2) `for update` → (6) über den Spiegel-Trigger                       | keiner                                                                                  | ✓            |

**Sofern `entwurfSicherstellen` erfolgreich zurückkehrt, nehmen alle vier Pfade ihre Klassen
aufsteigend.** Reentry auf eine niedrigere Klasse ist ausschließlich zulässig, wenn dieselbe
Transaktion diese Klasse bereits hält; ein **erster** Erwerb von Klasse (2) nach Klasse (5)
existiert auf keinem Pfad mehr. Scheitert der Helfer (Runden erschöpft, `55P03`), ist die
Ordnung nicht etabliert — dann bricht die Transaktion **benannt** ab, bevor irgendeine höhere
Klasse genommen wurde; auch das ist kein `5 → 2`.

Klasse (3) (`worksite_days` get-or-create) braucht keinen eigenen Sperrvertrag: die Zeile trägt
keine Planungsdaten, ihr Unique ist die Identitätsgarantie, und kein Pfad wartet auf sie,
während er eine höhere Klasse hält.

Damit entfallen die beiden Revision-4-Zyklus-Paare endgültig — auch für den existierenden
Draft. Das `40P01`-Mapping bleibt defensive Sicherheitsleine, in keinem Test ein vorgesehener
Ausgang.

#### Publish ↔ createAssignment (Crosscheck, vier gemessene Interleavings)

| Fall                                                                    | Wartepunkt                                                                                                             | Ausgang                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1 — Publisher hält nur `for update`**                                | `createAssignment` wartet im Helfer am `for share` und hält **keinen** Employee-Lock (5)                               | Nach dem Publish-Commit liefert `for share` 0 Zeilen (EPQ); die nächste Runde legt den **Folgedraft** an, die Zuweisung landet dort. Kein Zyklus, kein `23514`                                                   |
| **A2 — Publisher hat `published_at` bereits geschrieben (uncommitted)** | `createAssignment` wartet schon am `insert … on conflict do nothing` (Index-Tupel), nicht am `for share`               | Nach dem Commit ist der alte Index-Eintrag tot, der Insert gewinnt: `createAssignment` wird Insert-Gewinner, es entsteht ein neuer Draft samt Kopie                                                              |
| **B — createAssignment nimmt (2) zuerst** (existierender Draft)         | `publishPlan` wartet an seinem `for update`                                                                            | `createAssignment` gibt mit Commit/Rollback frei, dann läuft Publish weiter. Keine Teilwirkung                                                                                                                   |
| **C — createAssignment ist Insert-Gewinner** (kein Draft existierte)    | keiner: die neue Zeile ist für den Publisher unsichtbar, sein `for update` findet 0 Zeilen und wartet nicht (gemessen) | Publish findet **keinen Draft** und antwortet 409 `ALREADY_PUBLISHED` bzw. `STALE_VERSION { aktuelleVersionId: null }` — **veröffentlicht wird nichts**. Die Zuweisung landet im neuen, danach committeten Draft |

In allen vier Fällen: kein Zyklus, keine wechselseitige Wartekante, veröffentlichte Zeilen
unverändert, keine Teilwirkung. **N6** (B.4.4, M5, §11) misst **alle vier** Fälle — A1, A2, B
und C — mit je einem eigenen, nach B.4.5 synchronisierten Durchlauf. **`23514` ist in keinem
der vier Fälle ein zulässiger Ausgang:** tritt es auf, ist N6 rot. Der Trigger
`assignments_reject_published_plan` bleibt als Tiefenverteidigung bestehen — dass er scharf ist,
belegt Guard 4b unter `ohnePublishRecht` (M4), nicht ein Wettlauf.

### B.4.4 Cross-Command-Erwartungen (Finding 6, Tests N1–N5)

| Fall                                                                                                                              | Erwartung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N1** Team-Update ↔ Team-Update (gleicher Tag)                                                                                   | genau ein Gewinner; Verlierer `STALE_WORKSITE_DAY` **ohne** ausgeführtes Delta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **N2a** Publish committet, BEVOR das Team-Update seine Konfiguration auflöst                                                      | das Team-Update **gelingt**: `entwurfSicherstellen` legt den Folgedraft an und kopiert, `worksiteDayId` bleibt, `configurationId` ist neu, `lockVersion` wird übernommen und erhöht — das ist Fall E unter Nebenläufigkeit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **N2b** Team-Update hält den Draft bereits, Publish will veröffentlichen                                                          | **nach F2 kein Wettlauf mehr:** das Team-Update hält seit `entwurfSicherstellen` Klasse (2) `for share`, der Publisher blockiert an seinem `for update`. Der Fall „Publish committet dazwischen“ ist damit unerreichbar. Gemessen wird stattdessen: der Publisher wartet, das Team-Update committet, danach veröffentlicht der Publisher den fertigen Stand — **kein** `23514` aus Guard 4b unter Nebenläufigkeit, keine Teilwirkung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **N3** Team-Update ↔ `createAssignment` (dieselbe Person)                                                                         | nach dem Reorder (B.4.3) **kein Deadlock**: beide Transaktionen terminieren. Zulässige Kombination ⇒ beide committen konsistent; kollidierende Intervalle ⇒ der Verlierer erhält `OVERLAPPING_ASSIGNMENT` (Domainkonflikt), kein Teilzustand, kein Lost Update                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **N3b** `planWorksiteDay` ↔ `createAssignment` (dieselbe Person, Woche ohne Draft)                                                | wie N3: **kein Deadlock**; genau eine Transaktion legt den Entwurf an und kopiert, die andere arbeitet auf demselben Entwurf weiter; bei kollidierenden Intervallen benannter Domainkonflikt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **N4** Team-Update ↔ `planWorksiteDay` (dieselbe Identität)                                                                       | `planWorksiteDay` läuft in Unique I-3 → `DUPLICATE_WORKSITE_DAY`; das Team-Update bleibt konsistent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **N6** `publishPlan` ↔ `createAssignment` (dieselbe Woche), synchronisiert nach B.4.5 — **vier Durchläufe: A1, A2, B, C** (B.4.3) | beide Transaktionen terminieren, **kein** `40P01`, **kein** `23514`, kein 500er. **A1** (Draft vorhanden, Publisher hält `for update` zuerst): `createAssignment` wartet im Helfer am `for share` und hält dabei **keinen** Employee-Lock; nach dem Publish-Commit liefert die Wiederholungsrunde den **Folgedraft**, die Zuweisung landet dort, der veröffentlichte Vorgänger bleibt unverändert. **A2** (Publisher hat `published_at` uncommitted geschrieben): `createAssignment` wartet am Index-Tupel des `insert … on conflict do nothing` und wird nach dem Commit Insert-Gewinner **genau eines** Folgedrafts. **B** (Draft vorhanden, `createAssignment` nimmt Klasse (2) zuerst): `publishPlan` wartet nachweislich an seinem `for update`; `createAssignment` committet, danach veröffentlicht Publish **denselben** Draft **einschliesslich** der neuen Zuweisung. **C** (kein Draft, `createAssignment` ist Insert-Gewinner): der Publisher sieht die uncommittete Zeile nicht, veröffentlicht **nichts** und antwortet mit dem Bestands-409 (`STALE_VERSION`, `aktuelleVersionId: null`, auf einer Woche ohne jede Version; `ALREADY_PUBLISHED`, wenn die Woche bereits eine veröffentlichte Version trägt); `createAssignment` committet anschließend seinen neuen Draft. In allen vier: veröffentlichte Zeilen byte-gleich, keine Teilwirkung |
| **N5** zwei Commands kopieren gleichzeitig erstmalig den Draft                                                                    | `insert … on conflict do nothing` lässt genau einen gewinnen (partieller Unique `plan_versions_one_draft_per_week` ist die Autorität); **nur** der Gewinner kopiert; der Verlierer wartet auf dessen Commit und liest den fertigen Draft — keine doppelte Kopie, keine doppelte Tageskonfiguration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**N2 war in Revision 3 falsch formuliert** („scheitert deterministisch") und widersprach damit
B.4.2 und Test E, die für dieselbe Situation Erfolg fordern. Der Ausgang hängt am Interleaving;
beide Ausgänge sind oben getrennt beschrieben und werden getrennt geprüft. In **beiden** bleiben
die veröffentlichten Zeilen unverändert und es gibt kein Lost Update — das ist die Aussage, die
N2 trägt. Der früher genannte `WORKSITE_DAY_NOT_FOUND`-Zweig ist hier **unerreichbar**: nach dem
Kopieren existiert im Draft für jede Identität der zuletzt veröffentlichten Version eine
Konfiguration, und gelöscht werden kann sie nicht (kein `delete`-Grant).

### B.4.5 Wie die Paralleltests Gleichzeitigkeit erzwingen (R5-3)

Zwei nebenläufig gestartete Promises beweisen nichts: sie können sequentiell durchlaufen, und
der Test wäre grün, ohne je zwei kritische Lockpfade gleichzeitig gehalten zu haben. N3, N3b und
N6 verwenden deshalb **zwei getrennte Datenbankverbindungen mit je eigener Transaktion** und
eine **erzwungene Barriere**:

1. Beide Verbindungen öffnen ihre Transaktion und führen ihren Command bis unmittelbar **vor**
   den kritischen Lockschritt aus. Der Haltepunkt wird nicht geraten, sondern über einen
   Test-Hook gesetzt (dasselbe Muster wie `EASYTREE_SMOKE_FORCE_PROBE`/`vielleichtScheitern`
   im Bestand: eine nur in Tests gesetzte Umgebungsvariable bzw. ein injizierter Callback, der
   an einer benannten Stelle blockiert).
2. Der Test wartet, bis **beide** Verbindungen den Haltepunkt gemeldet haben — erst dann ist
   belegt, dass beide Transaktionen offen sind und ihre bisherigen Sperren halten.
3. Die Barriere wird gelöst; beide laufen in den kritischen Schritt.
4. Beide Ergebnisse werden mit einem **Timeout** eingesammelt. Läuft eine Seite in den Timeout,
   gilt der Test als **rot** (blockierte Session) — nicht als „langsam".
5. Nachlauf: `select count(*) from pg_stat_activity where wait_event_type = 'Lock' and datname
= current_database()` muss `0` sein. Eine hängende Session ist ein Fehlschlag, kein Rest.

**Nachweis der Wirksamkeit (Pflicht, nicht optional):** die Gegenmutation aus M3 — die
Personensperre zurück vor `entwurfSicherstellen` schieben — muss N3 und N3b **reproduzierbar
rot** machen (`40P01` in einer der beiden Sessions). Wird sie nicht rot, misst die Barriere
nicht, was sie messen soll, und der Test ist Ausführungsevidenz statt Beweis.

**Die vier N6-Haltepunkte sind benannt, nicht dem Zufall überlassen.** Jeder Durchlauf setzt
seinen Haltepunkt so, dass genau das gewünschte Interleaving entsteht — `Promise.all()` ohne
Haltepunkt und ein `sleep` als alleinige Synchronisierung sind ausdrücklich unzulässig, weil
beide auch dann grün werden, wenn die Commands zufällig nacheinander liefen:

| Durchlauf | Startzustand                | Haltepunkt der einen Seite                                                | freigegeben wird                                                          |
| --------- | --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **A1**    | Draft vorhanden             | Publisher hält `for update` und hält **vor** dem `update published_at`    | `createAssignment` läuft in `app.lock_week_draft`, dann committet Publish |
| **A2**    | Draft vorhanden             | Publisher hält **nach** dem `update published_at`, vor dem Commit         | `createAssignment` läuft in den Insert, dann committet Publish            |
| **B**     | Draft vorhanden             | `createAssignment` hält **nach** dem Helfer, vor `lock_employee_planning` | Publisher läuft in sein `for update` und wartet dort belegbar             |
| **C**     | keine Version für die Woche | `createAssignment` hält **nach** dem Insert-Gewinn, vor dem Commit        | Publisher läuft vollständig durch und liefert seinen 409                  |

Der Wartenachweis ist in jedem Durchlauf eine Messung, keine Annahme: die wartende Seite steht
mit `wait_event_type = 'Lock'` in `pg_stat_activity`, und für A1 zusätzlich **ohne**
Advisory-Eintrag in `pg_locks` (`locktype = 'advisory'`), weil sie den Employee-Lock zu diesem
Zeitpunkt nicht halten darf.

**`40P01` wird getrennt geprüft.** Die defensive Übersetzung `40P01` → wiederholbarer Fehler
statt 500er ist eine eigene, **einstellige** Zusicherung (Unit-Ebene: die Fehlerabbildung der
Route), **kein** PASS-Kriterium von N3/N3b. Dort gilt das Gegenteil: tritt `40P01` auf, ist der
Test rot.

## B.5 Idempotenz: Replay liefert die ERSTE Antwort (Finding 3, R-21)

**Verworfen:** „Replay liefert den aktuellen Tag-Stand." Das widerspricht 0012 wörtlich („der
Vertrag schuldet dem Aufrufer bei einer Wiederholung dieselbe Antwort … Ergebnis des ERSTEN
Aufrufs") und ist bei einem **mutierbaren** Subjekt nachweisbar falsch: nach einer späteren
Teamänderung läge ein anderer Stand vor, etikettiert als Antwort des ersten Aufrufs.

**Gewählt: Variante A — `idempotency_records.result_payload` (additiv, unveränderlich).**

| Anforderung                                | Umsetzung                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gleicher Key + gleicher Payload            | keine neue Wirkung; Rückgabe von `result_payload` **ohne** Lesen der aktuellen Zeilen; `replayed: true`                                                                                                                                                                                                                                                                                                                                                                   |
| gleicher Key + anderer Payload             | `IDEMPOTENCY_KEY_REUSED` (Fingerprint-Vergleich; Kanonisierung unten)                                                                                                                                                                                                                                                                                                                                                                                                     |
| spätere Mutationen ändern das Replay nicht | die Spalte ist insert-only (kein update-/delete-Grant, 0012)                                                                                                                                                                                                                                                                                                                                                                                                              |
| aktueller Stand separat lesbar             | `GET /planung/fenster` — das ist seine Aufgabe                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tenant/RLS/Least Privilege                 | **SELECT-Policy unverändert** (org-weit); die Grenze sitzt auf der **Spalte**: `revoke select on table` + Spalten-Grant ohne `result_payload`, dazu `app.read_idempotency_result(operation, key)` als einzige Lesestelle (Laufzeitkanal + `planning.write` + nur die zwei Payload-Vorgänge). INSERT payload-gebunden (Kanal). Begründung unten                                                                                                                            |
| Datensparsamkeit                           | Inhalt ausschließlich **Ids, Zeitstempel, Zahlen** — keine Labels, keine Namen. **Aber ausdrücklich NICHT „derselbe Maßstab wie `audit_events.context`"**: `result_payload` ist historische Command-Evidenz und kann Personen- und Intervallzuordnungen enthalten, die aus dem aktuellen Draft später **entfernt** wurden. Es ist damit eine dauerhafte Nebenablage vergangener Planungsstände — deshalb die eigene Lesegrenze (unten) und deshalb bleibt sie insert-only |
| Migration                                  | B.2 Block 7: nullable Spalte, Objekt-Check, operationsgebundener Pflicht-Check, payload-gebundene INSERT-Policy, **SELECT-Spaltengrant** und `app.read_idempotency_result`                                                                                                                                                                                                                                                                                                |

**Gespeicherter Inhalt** (die vollständige, bereits validierte Erstantwort):

```jsonc
{
  "worksiteDayId": "…", // stabile Identität
  "configurationId": "…", // Revision, in der der Vorgang wirkte
  "lockVersion": 4, // Stand NACH dem Vorgang
  "localDate": "2026-08-18",
  "worksiteId": "…",
  "team": [
    { "assignmentId": "…", "employeeId": "…", "interval": { "startUtc": "…", "endUtc": "…" } },
  ],
}
```

`subject_id` bleibt gesetzt (Vertrag von 0012) und trägt die **`configurationId`**.
Die **vier** Bestandsvorgänge bleiben unverändert und lesen ihr Ergebnis weiter über
`subject_id`. Für drei von ihnen liefert das dasselbe wie ein gespeichertes Ergebnis:
`planning.publish_plan` und `costs.create_cost_snapshot` haben unveränderliche Subjekte, und
`planning.create_assignment` liest nur Spalten, die der Publish-Spiegel nicht berührt. **Für
`costs.create_rate_version` gilt das nicht** (Review-Befund, am Code verifiziert): sein Subjekt
ist eine `employee_rate_versions`-Zeile, deren `valid_to` von der nächsten Ablösung gesetzt wird
(`rate-repository.pg.ts`: Replay-Select :222–225, Mutation :295–297) — ein Retry liefert dort
heute schon nicht die Erstantwort. Das ist eine **bestehende** R-21-Verletzung, die dieser Slice
weder verursacht noch behebt; sie steht als MISSING in §15, statt hier wegdefiniert zu werden.

**Fingerprint-Kanonisierung (Review-Befund: der Bestand trägt das nicht).** Beide vorhandenen
Fingerprints sind flache Skalar-Joins fester Feldreihenfolge (`weekKey|employeeId|worksiteId|
startsAtUtc|endsAtUtc` bzw. `weekKey|expectedVersionId`); keiner deckt eine **Kollektion** ab.
Ohne festgelegte Regel entstünden zwei gegensätzliche Fehler: ein reihenfolgeabhängiger Join
lehnte einen legitimen Retry mit derselben Menge in anderer Reihenfolge als
`IDEMPOTENCY_KEY_REUSED` ab; ein Fingerprint ohne `team` gäbe einer **anderen**
Teamzusammensetzung die Antwort des ersten Aufrufs. Verbindliche Regel für beide Commands:

```
planWorksiteDay:        weekKey | worksiteId | localDate | <team>
updateWorksiteDayTeam:  weekKey | worksiteDayId | expectedLockVersion | <team>

<team> = die nach (employeeId, startUtc, endUtc) SORTIERTE Liste der Einträge,
         je Eintrag "employeeId~startIso~endIso", verbunden mit ";"
```

**NULL-Zweig (Review-Befund: war offen).** Ein Treffer mit passendem Fingerprint, aber
`result_payload IS NULL` bei einer der beiden neuen Operationen ist eine **Invariantenverletzung**
und wird als interner Fehler geworfen — niemals „erneut ausführen" (zweite Wirkung) und niemals
„aktuellen Stand lesen" (die verworfene Semantik). Abgesichert wird das nicht nur durch einen
Test, sondern durch die DB: 0019 trägt
`check (operation not in ('planning.plan_worksite_day','planning.update_worksite_day_team')
or result_payload is not null)`. Zusätzlich erhalten die neuen Operationen im Port eine eigene,
**nicht optionale** Signatur, damit tsc eine fehlende Übergabe zeigt.

**Warum SELECT und INSERT verschärft werden.** Heute prüft `idempotency_records_insert_in_org` nur
die Organisationszugehörigkeit — ohne Kanal und ohne Recht; 0017 hat diesen Bypass bewusst
stehen lassen, weil kein Verbraucher davon profitierte. Mit `result_payload` ändert sich genau
das: der Antwortkörper eines Commands käme direkt aus einer Spalte, die jede Sitzung mit
`authenticated` und Org-Mitgliedschaft über die PostgREST-Data-API selbst beschreiben könnte —
auch eine ohne `planning.write` und außerhalb des Laufzeitkanals. 0019 ergänzt die Policy
deshalb um eine **operationsgebundene** Kanalpflicht — `result_payload is null or
app.is_runtime_channel()` —, damit genau die neuen, Payload-tragenden Vorgänge den Kanal
brauchen und die beiden Kosten-Vorgänge unberührt bleiben (eine pauschale Fassung ließe
`costs.create_rate_version` an RLS scheitern; gemessen). M1 misst beide Richtungen: ein
Payload-Insert außerhalb des Kanals scheitert, ein Payload-loser gelingt weiterhin.

**Und warum das Schreibrecht allein nicht genügt — die Lesegrenze (R5-1).**
`idempotency_records` ist org-weit **lesbar**, und ein `result_payload` überlebt den Zustand,
den er beschreibt: wer ein Teammitglied aus einem Draft entfernt, entfernt es aus
`assignments` — im Idempotenzsatz des ursprünglichen Commands bleibt die Zuordnung unbefristet
stehen (0012 kennt bewusst keine Aufbewahrungsregel). **RLS löst das nicht:** eine Policy filtert
Zeilen, nicht Spalten. Sie könnte den Payload nur verbergen, indem sie die ganze Zeile
verschwinden lässt — und für jede Sitzung, welche die Zeilenbedingung erfüllt, wäre er wieder
vollständig lesbar, auch per roher Abfrage. Der Vertrag sitzt deshalb auf der **Spalte**:

| Ebene              | Regel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabellen-Grant     | `revoke select on table public.idempotency_records from authenticated`, danach Spalten-Grant auf `(id, org_id, operation, idempotency_key, subject_id, request_fingerprint, created_at)` — **ohne** `result_payload`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| SELECT-Policy      | **wörtlich unverändert** (`org_id in (select app.user_org_ids())`) — maximale Legacy-Kompatibilität                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| einzige Lesestelle | `app.read_idempotency_result(p_operation, p_key)`: `security definer`, `stable`. Reihenfolge ist normativ: (a) Operation ∈ den zwei Payload-Vorgängen, (b) `app.is_runtime_channel()`, (c) **Organisation deterministisch aus dem authentisierten Kontext** (`select array_agg(o) … from app.user_org_ids() as o`; leer oder mehr als eines ⇒ fail-closed mit `42501` — **kein** `order by … limit 1`, kein Org-Parameter; `v_orgs[1]` wird erst nach der Eindeutigkeitsprüfung gelesen), (d) `app.has_permission(v_org, 'planning.write')`, (e) Payload-Abfrage **mit `org_id = v_org`** über den vollständigen Unique-Schlüssel; fremd == inexistent ⇒ `null` |
| Application        | der Replay-Zweig der beiden neuen Commands ruft **ausschließlich** diese Funktion und liest `result_payload` nie über eine eigene Abfrage. Die Grenze hat damit **vier** Bedingungen: Vorgang, Kanal, Recht **und Mandantenbindung** (F1)                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Warum die Funktion die Organisation selbst auflöst (F1).** `security definer` schaltet RLS
**ab** — die Funktion darf sich also nicht darauf verlassen, dass die Zeilensicht sie schützt.
Der Unique-Schlüssel von 0012 ist `(org_id, operation, idempotency_key)`, **nicht**
`(operation, key)`: zwei Organisationen dürfen denselben Vorgangsnamen und denselben Schlüssel
führen. Eine Abfrage ohne `org_id` könnte deshalb die Zeile eines fremden Mandanten auswählen,
**bevor** die Zugehörigkeit geprüft ist. Die Revision-5-Fassung filterte
erst danach (`if not found or v_org not in (…) then return null`). Gemessen am lokalen Stack
(zwei Organisationen, gleicher Vorgang, gleicher Schlüssel): der ungebundene Select liefert
`found=t` mit der **fremden** Zeile — eine B-Abfrage trifft `{"org": "A"}`. Der Nachfilter
verwarf sie, der Aufrufer bekam also einen **Replay-Miss** statt seiner Erstantwort; bei
mehrdeutigem Mitgliedschaftskontext kam hinzu, dass es gar keine eindeutige Organisationswahl
gab. Revision 6 beseitigt die Fehlerklasse an der Wurzel — Auflösung **vor** dem Select,
Bindung **in** der Abfrage —, statt eine falsche Auswahl nachträglich zu reparieren. Die Organisation wird daher **vor** der Auswahl aus dem authentisierten
Kontext bestimmt (`app.user_org_ids()`), niemals aus einem Parameter, und die Payload-Abfrage
bindet `org_id` explizit. Die Regel ist dieselbe wie im Planning-Command: **genau eine** aktive
Organisation, sonst fail-closed — dort als `NO_ORGANISATION` / `AMBIGUOUS_ORGANISATION`
(`planning-writes.port.ts:35/37`, aufgelöst über `select id, time_zone from
public.organizations`). Ein `order by … limit 1` wäre geraten und ist ausgeschlossen;
`v_orgs[1]` wird erst gelesen, nachdem genau ein Element feststeht, ist dort also die Identität
und keine Auswahl. Die naheliegende Kurzform `min(o)` ist **nicht verwendbar** — PostgreSQL
kennt kein `min(uuid)`; gemessen am lokalen Stack: `ERROR: function min(uuid) does not exist`.
`array_agg` über `setof uuid` ist ebenfalls gemessen (leer ⇒ `NULL`, eine Zeile ⇒
`array_length = 1`, zwei ⇒ `2`). **Die gesamte Auflösung ist als Nachbau gegen den lokalen
PostgreSQL-Stack gemessen** — zwei Organisationen mit demselben `operation` und demselben
`idempotency_key`, verschiedene Payloads:

```
F1-P5: OrgA={"payload": "A"}  OrgB={"payload": "B"}  OrgC_fremd=NULL
F1-FAILCLOSED bei 0 Orgs: SQLSTATE=42501
```

Damit ist der P5-Vertrag nicht nur spezifiziert, sondern in seiner tragenden Mechanik belegt;
M4 wiederholt ihn gegen das echte Schema und die echten Rechte. `into strict` wäre kürzer, wirft aber `P0002` — den Code, den
`app.remove_assignment_from_worksite_day` in derselben Migration mit anderer Bedeutung führt;
an einer Sicherheitsgrenze ist ein doppelt belegter SQLSTATE vermeidbar. **Rollenverteilung:**
die Anwendung prüft die Eindeutigkeit bereits in B.7 Schritt 1, also vor der Idempotenz in
Schritt 2; der Riegel in der Funktion ist Tiefenverteidigung, und sein Auslösen ist eine
Invariantenverletzung statt eines Fachfalls — deshalb genügt dort ein einheitliches `42501`.

**Legacy-Kompatibilität, gemessen statt behauptet:** der einzige Bestandsleser ist
`pg-idempotency-store.ts:26-28` (`select subject_id, request_fingerprint from
public.idempotency_records where operation = $1 and idempotency_key = $2`); ein `select *` auf
diese Tabelle existiert im Repository nicht. Beide Spalten bleiben im Grant, die Policy bleibt
unverändert — alle vier Bestandsvorgänge (`planning.create_assignment`, `planning.publish_plan`,
`costs.create_rate_version`, `costs.create_cost_snapshot`) laufen unberührt weiter, inklusive
ihres `subject_id`-Replaypfads.

Die verwendete Rechtefunktion ist **nicht erfunden**: `app.has_permission(uuid, text)` (0015)
ist `stable`, `security definer`, `search_path = ''`, an `authenticated` gegrantet und trägt
bereits die `assignments`-INSERT-Policy (0017); `planning.write` ist in `role_permissions` für
`owner` und `manager` vergeben (0015).

**Replay-Rückgabe.** Der gelesene `result_payload` wird vor der Rückgabe durch
`WorksiteDayDtoSchema` geparst: das erzwingt eine deterministische Feldreihenfolge (Test K1) und
lässt einen strukturell veralteten Payload laut scheitern, statt ihn durchzureichen.

**Pflichttest K1** (Finding 3): K1 anlegen → Zustand A, Ergebnis A. K2 verändert das Team →
Zustand B. Retry von K1 → `replayed: true`, Antwort **gleich Ergebnis A** (tiefe Gleichheit nach
`WorksiteDayDtoSchema.parse`, nicht Byte-Gleichheit des Körpers: `jsonb` normalisiert die
Schlüsselreihenfolge), **nicht** Zustand B. Zusätzlich zählbar: `lock_version` der
Draft-Konfiguration vor == nach dem Retry, und die Zeilenzahlen von `worksite_days`,
`worksite_day_configurations`, `assignments` vor == nach dem Retry, je einzeln. Zwei
Gegenmutationen: (a) Replay auf Re-Read umstellen ⇒ K1 rot; (b) den Idempotenz-Zweig hinter den
CAS-Bump verschieben ⇒ K1 rot (der Zähler steigt bei jedem Retry).

## B.6 Leerer Baustellentag und Publish (Finding 4, R-22)

**Entscheidung (Variante „verbieten", vom Orchestrator ausdrücklich zugelassen):** In Slice 1
entsteht **kein** leerer Baustellentag. Beide Commands lehnen ein leeres Ziel-Team ab; der
Publish trägt zusätzlich einen Riegel als Tiefenverteidigung.

Der Grund für die Abkehr von „leer erlaubt, Publish blockiert" ist ein Review-Befund: Der Slice
stellt **keinen Ausgang** aus einem leeren Tag bereit. Tag-Löschen ist DEFERRED, beide neuen
Tabellen haben bewusst keinen `delete`-Grant, und `app.remove_assignment_from_worksite_day`
entfernt nur Zuweisungen. Der einzige Ausweg wäre, dem Tag ein Team zu geben — und dieser Weg
ist verschließbar: die Auswählbarkeitsprüfung verlangt eine **aktive** Baustelle, und
`worksites.active` ist für `authenticated` org-weit schreibbar (0006). Wer einen Tag
versehentlich anlegt und die Baustelle danach deaktiviert, könnte die Woche dauerhaft nicht mehr
veröffentlichen. Ein Zustand ohne Ausgang ist schlimmer als einer, der gar nicht erst entsteht.

| Aspekt                       | Regel                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anlegen mit leerem Team      | **abgelehnt**: `planWorksiteDay` mit `team: []` ⇒ 400 `WORKSITE_DAY_TEAM_REQUIRED`                                                                                                                                                                                                                                                                                                              |
| Team auf leer setzen         | **abgelehnt**: `updateWorksiteDayTeam` mit `team: []` ⇒ 400 `WORKSITE_DAY_TEAM_REQUIRED`                                                                                                                                                                                                                                                                                                        |
| Folge                        | ein Baustellentag hat per Konstruktion immer mindestens eine Zuweisung; eine Publish-Sackgasse kann nicht entstehen                                                                                                                                                                                                                                                                             |
| Publish (Tiefenverteidigung) | `publishPlan` lehnt eine Version ab, die eine Tageskonfiguration **ohne Zuweisung und ohne einen Status, der Zuweisungsfreiheit erlaubt** enthält: 409 mit dem Problem-Typ `WORKSITE_DAY_INCOMPLETE`. Die zweite Bedingung ist in Slice 1 **wirkungsgleich weggelassen** (es gibt keine Statusspalte), aber von Anfang an mitformuliert, damit EYT-121 den Riegel **erweitert statt aufweicht** |
| Arbeitsfrei                  | ausdrücklich **nicht** modelliert; `arbeitsfrei/ausgesetzt/abgesagt` folgen in EYT-121 (Stufe 0021) und bringen dann ihren eigenen Ausgang mit                                                                                                                                                                                                                                                  |
| Plan-Aussage                 | der Slice unterstützt **keine** leeren oder arbeitsfreien Tage — das wird nirgends behauptet                                                                                                                                                                                                                                                                                                    |

**Warum der Publish-Riegel trotzdem gebaut wird, obwohl er im Slice unerreichbar ist:** er
sichert Datenanomalien und alles, was nach dem Slice kommt (EYT-120 bringt einen Generator). Er
wird als solcher **benannt** und mit einer über die Beobachterverbindung künstlich erzeugten
leeren Konfiguration geprüft (Test M), damit er kein Wächter wird, der nie feuert.

**Verhältnis zu EYT-121 (Review-Befund, sonst eine stille Kollision).** `setWorksiteDayStatus`
(A.4) soll einen Tag ohne Team in einen definierten, veröffentlichbaren Zustand überführen. Ein
unbedingter Riegel „jede Konfiguration ohne Zuweisung blockiert" machte genau das unmöglich —
EYT-121 müsste eine im Slice gebaute Publish-Regel wieder aufweichen, und §12 („jede Stufe ist
expandierend") wäre verletzt. Deshalb trägt die Regel die Statusbedingung **von Anfang an**:
solange die Statusspalte fehlt (Slice 1), ist sie wirkungsgleich mit der unbedingten Fassung;
mit Stufe 0021 erweitert EYT-121 nur die Wertemenge des erlaubten Status. Test M prüft die heute
erreichbare Hälfte; die Statushälfte gehört zu EYT-121.

**Vertragsfolgen (Review-korrigiert):** `WORKSITE_DAY_INCOMPLETE` wird **nicht** in
`CONFLICT_CODE_VALUES` (Transport) aufgenommen. Dieser Enum hat genau einen Verbraucher —
`PlanningConflictDtoSchema` in `PlanValidationResultSchema`, also die **Validierungsroute** — und
weil `validateDraft` nicht erweitert wird, bekäme er dort einen Wert, den sein einziger Produzent
nie erzeugen kann: exakt das Anti-Muster „deklarierter Code ohne Produzent", das
`assignment-draft.ts` selbst benennt. Stattdessen ist `WORKSITE_DAY_INCOMPLETE` ein eigener
**Problem-Typ** im `PLANNING_ERROR_TYPE`-Katalog am 409 des Publish; `CONFLICT_CODES`,
`CONFLICT_CODE_VALUES` und `KONFLIKT_TEXT` bleiben damit **unverändert**. Der in Revision 3
geplante Konfliktcode-Paritätstest entfällt als Slice-Pflicht; die in §0 gemessene Lücke bleibt
als MISSING in §15 stehen, statt sie an ein Ticket zu hängen, das sie nicht braucht.

**`validateDraft` wird nicht erweitert.** Sein Vertrag trägt einen einzelnen `AssignmentDraft`,
kein Wochenobjekt; eine Wochenprüfung dort lieferte Konflikte, die nichts mit dem übergebenen
Entwurf zu tun haben, und wäre eine Semantikänderung des Bestandscontracts. R-22 („niemals
stillschweigend veröffentlichbar") ist über die Command-Ablehnung **und** den Publish-Riegel
doppelt erfüllt.

## B.7 Command-Verträge

```ts
// packages/contracts/src/planning/schemas.ts — NEU
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(istRealerKalendertag, { message: "…" }); // Muster + Kalenderregel wie IsoWeekKeySchema

export const WorksiteDayTeamEntrySchema = z.strictObject({
  employeeId: IdSchema,
  interval: TimeIntervalDtoSchema, // R-04: eigenes Intervall je Eintrag, mehrere je Person
});

export const WorksiteDayTeamMemberSchema = z.strictObject({
  assignmentId: IdSchema,
  employeeId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export const WorksiteDayDtoSchema = z.strictObject({
  worksiteDayId: IdSchema, // STABIL über Revisionen (R-01)
  configurationId: IdSchema, // Revision, aus der dieser Stand stammt (R-26)
  worksiteId: IdSchema,
  localDate: LocalDateSchema,
  lockVersion: z.number().int().nonnegative(),
  // BEWUSST OHNE .min(1): die COMMAND-Schemata verbieten ein leeres Team (B.6), das
  // ANTWORT-DTO nicht. Sonst quittierte eine Datenanomalie (Konfiguration ohne Zuweisung —
  // genau der Zustand, den der Publish-Riegel abfängt) den Lesepfad mit 500, weil der
  // Controller seine eigene Antwort validiert; die ganze Woche wäre dann unlesbar.
  team: z.array(WorksiteDayTeamMemberSchema),
});

export const PlanWorksiteDayCommandSchema = z.strictObject({
  weekKey: IsoWeekKeySchema, // die GEÖFFNETE Woche; der Server vergleicht
  worksiteId: IdSchema,
  localDate: LocalDateSchema,
  team: z.array(WorksiteDayTeamEntrySchema).min(1), // B.6: kein leerer Baustellentag
});

export const UpdateWorksiteDayTeamCommandSchema = z.strictObject({
  weekKey: IsoWeekKeySchema,
  worksiteDayId: IdSchema, // STABIL — nie die Konfigurations-Id (B.4.2)
  expectedLockVersion: z.number().int().nonnegative(),
  team: z.array(WorksiteDayTeamEntrySchema).min(1), // ZIEL-Zustand, leer verboten (B.6)
});
// refine je Command: keine zwei identischen (employeeId, interval)-Paare; überlappende
// Intervalle derselben Person im selben Command abgelehnt (Vorstufe zu I-5).
```

Serverseitige Semantik (beide Commands, **eine** Transaktion):

1. Organisation + `time_zone` lesen. Syntaktische Vorprüfungen sofort; die **Tagesbindung (I-2)
   erst, wenn der lokale Tag feststeht** — `planWorksiteDay` trägt ihn selbst, bei
   `updateWorksiteDayTeam` steht er erst nach Auflösung der `worksite_days`-Zeile fest
   (Review-Befund: der Team-Command trägt kein `localDate`, die Prüfung war für ihn nicht
   ausführbar). Geprüft wird in beiden Fällen je Eintrag
   `localBusinessDate(interval.startUtc, tz) == local_date` (sonst
   `INTERVAL_OUTSIDE_DAY { employeeId }`) und Woche von `local_date` == `weekKey` (sonst
   `OUTSIDE_WEEK`). Für `updateWorksiteDayTeam` wird die `worksite_days`-Zeile dafür **vor**
   `entwurfSicherstellen` gelesen (sie ist versionsunabhängig), damit ein Wochen- oder
   Tagesfehler keinen Draft erzeugt. Leeres `team` ⇒ `WORKSITE_DAY_TEAM_REQUIRED` (B.6),
   ebenfalls vor jeder Mutation. **Damit dieser Typ über HTTP überhaupt erreichbar ist**
   (Review-Befund): das Bestandsmuster wirft bei jedem fehlgeschlagenen `safeParse` einen
   generischen 400 mit `INVALID_INTERVAL`, bevor das Repository läuft — `.min(1)` allein
   erzeugte also nie den benannten Typ. Der Controller prüft deshalb den `issue.path` des
   fehlgeschlagenen Parse: enthält er `team` mit `too_small`, antwortet er mit
   `WORKSITE_DAY_TEAM_REQUIRED`; sonst bleibt es beim Bestandsverhalten.
2. Idempotenz: `lock` → `find` (Fingerprint kanonisiert nach B.5); Fingerprint gleich ⇒
   **`result_payload` durch `WorksiteDayDtoSchema` parsen und zurückgeben** (`replayed: true`,
   kein Lesen der aktuellen Zeilen); `result_payload IS NULL` bei einer der neuen Operationen ⇒
   interner Fehler (Invariantenverletzung, durch den DB-Check ohnehin unerreichbar);
   Fingerprint ungleich ⇒ `IDEMPOTENCY_KEY_REUSED`.
3. Autorisierung: Route `planning.write`; die RLS-Policies prüfen Kanal und Recht erneut.
4. Auswählbarkeit: Baustelle aktiv, jede Person aktiv (`RESOURCE_NOT_SELECTABLE`; RLS-unsichtbar
   ⇒ identische Antwort wie inaktiv — kein Tenant-Leak).
5. `planWorksiteDay`: `entwurfSicherstellen` (kehrt mit gehaltenem Klasse-(2)-Lock zurück,
   B.4.3) → `worksite_days` **get-or-create**
   (`insert … on conflict (org_id, worksite_id, local_date) do nothing` + Select) →
   Konfiguration einfügen (Unique-Kollision ⇒ `DUPLICATE_WORKSITE_DAY`) → Personensperren
   (sortiert) → je Eintrag Überlappungscheck (`during &&`) → N Inserts mit
   `worksite_day_configuration_id`.
6. `updateWorksiteDayTeam`: Ablauf **normativ** nach B.4.2 — `entwurfSicherstellen` →
   Konfiguration über `worksite_day_id` + Draft-Version auflösen → **CAS-Bump** → Ist-Team lesen
   → Delta über `(employeeId, interval)` (unveränderte Paare behalten Zeile und Id) →
   Personensperren für die Vereinigungsmenge → Entfernte über
   `app.remove_assignment_from_worksite_day(assignmentId, configurationId)` → Hinzugefügte mit
   Überlappungscheck einfügen.
7. Audit + Outbox + Idempotenzrecord (**mit `result_payload`**) in derselben Transaktion.
8. **Rollback-Mechanik.** Der `TenantQueryRunner` committet bei normalem Return und rollt nur
   bei einer Exception zurück [R]; `createAssignment` gibt Konflikte als `ok:false` zurück und
   committet dabei die Entwurfsanlage — für einen Einzel-Insert tragbar, für Multi-Row-Schreiben
   nicht. Die beiden neuen Commands signalisieren Domänenkonflikte deshalb **innerhalb** der
   Transaktion als interne Exception (Problem-Payload in der Exception; `aktuelleLockVersion`
   vor dem Throw gelesen) und übersetzen sie **nach** `runner.run` in `{ ok: false, problem }`.
   **Abschließend als interne Exception geworfen:** `WORKSITE_DAY_NOT_FOUND`,
   `STALE_WORKSITE_DAY`, `DUPLICATE_WORKSITE_DAY`, `INTERVAL_OUTSIDE_DAY`, `OUTSIDE_WEEK`,
   `RESOURCE_NOT_SELECTABLE`, `WORKSITE_DAY_TEAM_REQUIRED`, `OVERLAPPING_ASSIGNMENT`,
   `IDEMPOTENCY_KEY_REUSED` — jeder Ausgang außer Erfolg und Replay.
   Ergebnis: ein Fehler irgendwo — auch bei Person 7 von 10 — rollt alles zurück (Test B).
9. Antwort: `WorksiteDayDto` (stabile Id **und** Konfigurations-Id, neuer `lockVersion`, Team).

**Routen:** `POST /planung/baustellentage` (201, `planWorksiteDay`),
`POST /planung/baustellentage/team` (200, `updateWorksiteDayTeam`) — Command-Stil ohne
Pfadparameter wie die vier Bestandsrouten, beide mit Pflicht-`Idempotency-Key`.

**Fenster:** `PlanningWindow` additiv um `worksiteDays: WorksiteDayDto[]`; superRefine
zusätzlich: jede `worksiteId` in `resources.worksites`; jede `team.assignmentId` existiert in
`assignments` mit identischer `employeeId` und identischem `interval`; keine `assignmentId` in
zwei Teams; `worksiteDays` nur bei `sourceVersion !== null`.

## B.8 Web (Basis PR #101)

- `lib/wochenraster.ts` **ADAPT**: `Wochentag` erhält `baustellentage: WorksiteDayDto[]`
  (Gruppierung über `localDate`, ohne eigene Zonenrechnung — der Server hat den Tag benannt) und
  `einzelEinsaetze: AssignmentDto[]` (= `assignments` minus aller `team.assignmentId`s).
- `planning-window-view.tsx` **ADAPT**: primäre Karte = `Baustellentagkarte` mit Baustellenname,
  abgeleitetem Zeitraum und Teamnamen; `data-worksite-day-id` = **stabile** Id,
  `data-configuration-id` = Revision; als Button, den Klick **und** Enter/Space öffnen. Ein Tag
  ohne Team entsteht im Slice nicht (B.6); tritt er als Datenanomalie auf, rendert die Karte ihn
  sichtbar ohne Team, statt die Woche scheitern zu lassen. `Einsatzkarte` bleibt Fallback für
  Zuweisungen ohne Konfigurationsbezug. Inspector-Mechanik unverändert; Speichern sendet
  Ziel-Team + `expectedLockVersion`; 409 `STALE_WORKSITE_DAY` ⇒ Meldung + Nachladen.
- **NEU** `components/worksite-day-form.tsx` (ersetzt `planning-assignment-form.tsx` als
  Werkbank-Formular): **Baustelle → Datum → Beginn/Ende → Team-Mehrfachauswahl** (fieldset +
  Checkbox je aktiver Person); UTC-Umrechnung über das bestehende `zuIntervall`-Muster; das
  Formular bleibt „dumm", Gateway und Vorgangsschlüssel bleiben in der View.
- **Multi-Interval-Scope, ausdrücklich begrenzt.** Das Formular erzeugt **ein
  Initialintervall für mehrere Personen** — es ist **kein** Multi-Interval-Editor. Modell,
  Contract und beide Commands tragen mehrere und individuelle Intervalle je Person (R-04); die
  Werkbank **zeigt** sie korrekt an (mehrere Team-Einträge derselben Person in einer Karte).
  Das **Authoring** individueller oder mehrerer Intervalle je Person im Bearbeitungs-Inspector
  ist in Slice 1 **nicht** enthalten und gehört zu EYT-121. Der Slice behauptet an keiner
  Stelle, vollständiges Multi-Interval-Authoring sei bewiesen — Test F belegt Modell, Contract,
  API und **Anzeige**, nicht die Eingabe.
- Unverändert: `planning-publish-action.tsx`, `planungs-werkbank.tsx`, `planung-ansicht.tsx`,
  `planung-zugang.tsx`, `wochen-navigation.tsx`, Shell, Tokens, Guards.

## B.9 Cutover, Legacy, Bestandsdaten

| Fall                                    | Regel                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historische veröffentlichte Zuweisungen | `worksite_day_configuration_id` bleibt `NULL`. **Kein Backfill** — er müsste veröffentlichte Zeilen ändern (0010: `23514`) und Konfigurationen in veröffentlichte Versionen einfügen (Guard 4a: `23514`); beides ist verboten und technisch versperrt (R-17)                                                                                                                                                              |
| Bestehende Draft-Zuweisungen            | bleiben `NULL`; keine nachträgliche Tag-Adoption im Slice (DEFERRED)                                                                                                                                                                                                                                                                                                                                                      |
| Bedeutung `NULL`                        | „ohne Baustellentag geplant" (Alt-Command oder Historie); erscheint im Fenster in `assignments`, in keinem Team, in der UI als Einzelkarte — nichts verschwindet (Test G)                                                                                                                                                                                                                                                 |
| Cutover neuer Writes                    | ab Auslieferung erzeugen die Werkbank-Pfade ausschließlich konfigurationsgebundene Zuweisungen; `createAssignment` bleibt vertragserhalten und schreibt weiter `NULL`. **Kein `not null`-Ziel** in diesem Slice                                                                                                                                                                                                           |
| Entwurfs-Kopie                          | **INTERNAL CHANGE**: Konfigurationen zuerst (neue Id, gleiche `worksite_day_id`, übernommener `lock_version`), dann Assignments mit Remap; geteilter Helfer `entwurfSicherstellen(tx, weekKey)`, den `createAssignment` und beide neuen Commands nutzen; er kehrt **nur mit gehaltenem Klasse-(2)-Lock** zurück (B.4.3) — im Fallback über `for share`, nicht mehr über einen plain `select`                              |
| Kosten/Employee/Publish                 | lesen `assignments` unabhängig von der neuen Spalte; Snapshots bleiben stabil (Tests G/L)                                                                                                                                                                                                                                                                                                                                 |
| Forward-Fix                             | Rückbau-Migration entfernt Trigger, Funktionen, Spalte und beide Tabellen und stellt die INSERT-Spaltenrechte auf den 0017-Stand zurück. **Zeitliche Grenze:** verlustfrei für veröffentlichte Historie nur, solange keine konfigurationsgebundene Woche veröffentlicht wurde; danach kostet er die Tagesidentitäten veröffentlichter Versionen (die Zuweisungen selbst bleiben vollständig) und ist eine PO-Entscheidung |
| Code-Rollback                           | Meilensteine rückwärts revertierbar; Contracts additiv; Web fällt auf Einzelkarten zurück                                                                                                                                                                                                                                                                                                                                 |

---

## 9. Preservation-Matrix (Finding 7)

| Element                                                                                                                                                                                                                                                                                                    | Klasse                                                                                                                                                                                                                                                                                                                                                                      | Beleg / Konsequenz                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /planung/versionen`, `PublishPlanCommand`, `PublishedPlanVersion`                                                                                                                                                                                                                                    | **PRESERVED EXTERNAL CONTRACT**                                                                                                                                                                                                                                                                                                                                             | Form, Route und Statuscodes unverändert; hinzu kommt genau ein neuer RFC-7807-`type` (`WORKSITE_DAY_INCOMPLETE`) am bestehenden 409 — **kein** neuer Konfliktcode (B.6)                                                                                                                                                                                                                           |
| `plan_versions.published_at`                                                                                                                                                                                                                                                                               | **PRESERVED AUTHORITATIVE STATE**                                                                                                                                                                                                                                                                                                                                           | einzige Publish-Marke; keine Tabelle des Slices trägt einen eigenen (R-19)                                                                                                                                                                                                                                                                                                                        |
| Assignment-Publish-/Kostenquelle (`publishedAssignments`, Snapshot-Positionen)                                                                                                                                                                                                                             | **PRESERVED SEMANTICS**                                                                                                                                                                                                                                                                                                                                                     | Query unverändert; die neue Spalte reist nicht mit; Snapshots werden nicht reinterpretiert                                                                                                                                                                                                                                                                                                        |
| `AssignmentDto`, `TimeIntervalDto`                                                                                                                                                                                                                                                                         | **PRESERVED EXTERNAL CONTRACT**                                                                                                                                                                                                                                                                                                                                             | falsifizierbar am generierten Vertrag statt als Urteil über einen großen Diff: `diff <(git show origin/master:packages/contracts/openapi/v1.json \| jq -S '.components.schemas.AssignmentDto') <(jq -S '.components.schemas.AssignmentDto' packages/contracts/openapi/v1.json)` **leer**, dasselbe für `TimeIntervalDto`                                                                          |
| `EmployeeSchedule` + 5 `/einsatz/*`-Operationen                                                                                                                                                                                                                                                            | **PRESERVED EXTERNAL CONTRACT**                                                                                                                                                                                                                                                                                                                                             | `git diff origin/master...HEAD -- packages/contracts/src/employee` leer; `NOT_YET_IMPLEMENTED` unverändert                                                                                                                                                                                                                                                                                        |
| Kosten-Schemata und -Routen                                                                                                                                                                                                                                                                                | **PRESERVED EXTERNAL CONTRACT**                                                                                                                                                                                                                                                                                                                                             | `git diff origin/master...HEAD -- apps/api/src/modules/costs packages/contracts/src/costs` leer                                                                                                                                                                                                                                                                                                   |
| **`publishPlan`-Implementierung** (Vollständigkeitsprüfung der Tageskonfigurationen)                                                                                                                                                                                                                       | **INTERNAL CHANGE REQUIRED** **eigener** Prüfschritt in `publishPlan` mit eigenem Problem `{ kind: "WORKSITE_DAY_INCOMPLETE" }` und eigenem `PLANNING_ERROR_TYPE`-Eintrag — **nicht** in `blockierendeKonflikte`, das per Bestand zwingend `BLOCKING_CONFLICT` erzeugt (verifiziert: write-repo :783–787, controller :179–186). **Keine Behauptung „wörtlich unverändert"** |
| **Entwurfs-Kopie und Auflösung der stabilen Tagesidentität**                                                                                                                                                                                                                                               | **INTERNAL CHANGE REQUIRED**                                                                                                                                                                                                                                                                                                                                                | B.4.2, B.9; `createAssignment` nutzt denselben Helfer und ist damit intern berührt                                                                                                                                                                                                                                                                                                                |
| **`createAssignment`-Implementierung** (Lock-Reihenfolge normalisiert: die Personensperre wandert hinter `entwurfSicherstellen`; **zusätzlich F2:** die Draft-Auflösung ruft die neue Domain-Funktion `app.lock_week_draft`, sodass der Helfer in allen Pfaden mit gehaltenem Klasse-(2)-Lock zurückkehrt) | **INTERNAL CHANGE REQUIRED**                                                                                                                                                                                                                                                                                                                                                | Blocker 2 + F2: beseitigt die beiden Zyklus-Paare und die letzte `5 → 2`-Erstakquisition. Externer Vertrag, Antwortform und Fachregeln unverändert; die Serialisierung von Prüfen-und-Einfügen bleibt wörtlich erhalten (0012-Zweck), weil zwischen Sperre und Überlappungscheck nichts liegt                                                                                                     |
| `getPlanningWindow`                                                                                                                                                                                                                                                                                        | **INTERNAL CHANGE REQUIRED** (+ additive Vertragserweiterung)                                                                                                                                                                                                                                                                                                               | Antwort erhält `worksiteDays[]`; bestehende Felder und Regeln unverändert                                                                                                                                                                                                                                                                                                                         |
| `IdempotencyStore`-Port + `idempotency_records`                                                                                                                                                                                                                                                            | **INTERNAL CHANGE REQUIRED** (additive Spalte, **verschärfte INSERT-Policy**)                                                                                                                                                                                                                                                                                               | `result_payload` + Pflicht-Check für die neuen Operationen; INSERT-Policy payload-gebunden; **SELECT-Recht auf Spaltenebene entzogen** (`result_payload` nicht mehr im Grant) und `app.read_idempotency_result` als einzige Lesestelle (B.5). SELECT-**Policy** unverändert; alle vier Bestandsoperationen unverändert (einziger Bestandsleser liest `subject_id, request_fingerprint`, gemessen) |
| **`public.assignments` als DB-Objekt** (neue Spalte `worksite_day_configuration_id`, FK, Index, Trigger, **neu ausgestellte INSERT-Spaltengrants**)                                                                                                                                                        | **INTERNAL CHANGE REQUIRED (DB)**                                                                                                                                                                                                                                                                                                                                           | der 0017-Grantumfang wächst um genau eine Spalte; update/delete bleiben entzogen. Beleg: 0012 A1/A2/A3/A4/B1/C2/C3 unverändert grün **plus** die tatsächlich neue Zusicherung `has_column_privilege('authenticated','public.assignments','worksite_day_configuration_id','INSERT')` — die Nicht-Erweiterung auf `id` deckt A4 bereits ab und läuft nach der Neuvergabe erneut                     |
| **`supabase/tests/0005_schema_meta_gate.sql`** (`EXPECTED_TABLES`)                                                                                                                                                                                                                                         | **INTERNAL CHANGE REQUIRED (Bestandssuite)**                                                                                                                                                                                                                                                                                                                                | genau zwei neue Wertezeilen, keine Zusicherung geändert. Beleg: `git diff origin/master...HEAD -- supabase/tests/0005_schema_meta_gate.sql \| grep -c '^-[^-]'` == 0                                                                                                                                                                                                                              |
| `CONFLICT_CODE_VALUES` / `CONFLICT_CODES` / `KONFLIKT_TEXT`                                                                                                                                                                                                                                                | **PRESERVED EXTERNAL CONTRACT** (unverändert)                                                                                                                                                                                                                                                                                                                               | `WORKSITE_DAY_INCOMPLETE` ist ein Publish-**Problem-Typ**, kein Konfliktcode — Begründung in B.6                                                                                                                                                                                                                                                                                                  |
| `WorksiteDayDto`, beide Commands, zwei Routen, neue Problem-Typen                                                                                                                                                                                                                                          | **NEW CONTRACT**                                                                                                                                                                                                                                                                                                                                                            | B.7                                                                                                                                                                                                                                                                                                                                                                                               |
| `worksite_days`, `worksite_day_configurations`, Guards, `app.remove_assignment_from_worksite_day`, `app.read_idempotency_result`, **`app.lock_week_draft`** (F2: Klasse-(2)-Erwerb als definer-Funktion mit Wiederholungsrunde; F3: an genau eine aktive Organisation gebunden, sonst `42501`)             | **NEW** (DB-intern)                                                                                                                                                                                                                                                                                                                                                         | B.2                                                                                                                                                                                                                                                                                                                                                                                               |
| Zeitraum, Default/Snapshot, Generator, Serienanwendung, Tagesstatus, Tätigkeiten, Ressourcen, Einreichen, Tag-Löschen, Tag-Adoption, `/einsatz/*`, `createAssignment`-Stilllegung                                                                                                                          | **DEFERRED**                                                                                                                                                                                                                                                                                                                                                                | in Teil A entschieden, nicht im Slice gebaut                                                                                                                                                                                                                                                                                                                                                      |

---

## 10. TDD-Plan M1–M8

**Rahmen:** Branch `feat/eyt-147-dispositionswerkbank-slice-1` (eine WIP-Lane). Sessionstart:
SHAs nach §0 reproduzieren; Abweichung ⇒ Drift rekonstruieren, nicht implementieren. Lokale DB:
`colima start` → `pnpm exec supabase start`. Rote Läufe werden **ausgeführt** gemessen;
Turbo-Zahlen nur mit `--force` und gelesener `Cached:`-Zeile; vitest-Läufe mit gelesener
Dateizahl.

**M1 — Migration 0019 + pgTAP `0014_worksite_days.sql`.** Rot zuerst: Struktur beider Tabellen
(Uniques I-3/I-4, FKs, `has_column_privilege` je Grant-Spalte inklusive
`worksite_day_configuration_id` und `result_payload`, `prosecdef`-Stolperdrähte für beide neuen
definer-Funktionen nach dem 0006-Muster). Angriffe als permanente Szenarien, **jeweils mit der
als `postgres` tatsächlich erreichbaren Erwartung** — pgTAP kann `session_user` nicht wechseln,
kanal- und RLS-abhängige Zweige sind hier nicht messbar: Konfiguration in veröffentlichte
Version einfügen → `23514`; Update/Delete einer Konfiguration veröffentlichter Version →
`23514`; doppelte Konfiguration (I-3) → `23505`; doppelte Identität (I-4) → `23505`; Zuweisung
mit fremder Baustelle/Version (I-1) → `23514`; `app.remove_assignment_from_worksite_day` aus
pgTAP → **`42501`** (Kanal-Guard zuerst; die Zweige `P0002` und `23514` sind hier unerreichbar
und liegen in M3/M4); **F-Beweis:** zwei Zuweisungen derselben Konfiguration mit verschiedenen
Intervallen werden angenommen; **Löschen eines UNVERÖFFENTLICHTEN `plan_versions`-Entwurfs mit
Tageskonfiguration gelingt** (Review-Messung: eine fail-closed-Variante von Guard 4b hätte genau
das und damit die Aufräumpfade der Bestandssuiten gebrochen); Lauf der **unveränderten**
0012-Suite (K). **Neue Katalog-Zusicherung (Review-Befund):** 0012 A1/A2/B1/C2/C3 sind gegenüber
einer `security definer`-Funktion, die mit Ownerrechten aus `public.assignments` löscht,
strukturell blind — gemessen: bei grünem A2/B1/C3 löschte ein definer-Weg die Zeile trotzdem.
M1 ergänzt daher: genau die benannte Menge von `app`-Funktionen mit `prosecdef = true` darf
`public.assignments` schreiben (Quelltext über `pg_get_functiondef` gegen
`delete from public.assignments` gematcht) — jede weitere ist ein Fehlschlag.
**Lesegrenze `result_payload` (R5-1):** **P2** ist hier strukturell und damit am schärfsten
messbar — `has_column_privilege('authenticated','public.idempotency_records','result_payload',
'SELECT')` muss **false** sein, alle übrigen Spalten **true** (**P1**). Dazu `prosecdef` und
`proacl` von `app.read_idempotency_result` sowie die Zusicherung, dass die SELECT-**Policy**
gegenüber 0012 **unverändert** ist (`pg_policies.qual` byte-gleich zur Bestandsbedingung) — die
Grenze soll auf der Spalte sitzen, nicht in der Zeilenbedingung. Von **P4** sind hier die Fälle
(a) „außerhalb des Kanals" und (d) „fremde Operation" erreichbar, weil pgTAP als `postgres`
läuft und `app.is_runtime_channel()` nie erfüllt; (b)/(c), **P3** und **P5** liegen in M3/M4.
**Strukturzusicherungen für `app.lock_week_draft` (F2):** `prosecdef = true`, `proacl` gibt
`execute` nur an `authenticated`, und der ausführbare Rumpf (Kommentare gestrippt) enthält
`for share` sowie eine Wiederholung — die Invoker-Variante im Anwendungscode ist damit
ausgeschlossen.
**Strukturzusicherungen fuer die F3-Mandantenbindung von `app.lock_week_draft`:** die Signatur
traegt **keinen** Organisationsparameter (`pg_get_function_arguments` == `p_week_key text`), und
der ausfuehrbare Rumpf (Kommentare gestrippt, gleiche `regexp_replace`-Vorbehandlung wie bei P5)
enthaelt weder `limit 1` noch `order by`, **kein** `org_id in (` und **mindestens ein**
`org_id = v_org` — die Mengenform aus Revision 7 ist damit strukturell ausgeschlossen, nicht nur
verhaltensmaessig. Der Grund fuer die Struktur**haelfte**: der gefaehrlichste F3-Fall braucht zwei
Organisationen in einer Identitaet, und die baut pgTAP hier nicht auf; die Verhaltenshaelfte
liegt in M3 (O2a-O2c).
**Strukturhälfte von P5 (F1):** die Signatur von `app.read_idempotency_result` trägt **keinen**
Organisationsparameter (`pg_get_function_arguments` == `p_operation text, p_key text`), und ihr
**ausführbarer** Quelltext enthält weder `limit 1` noch `order by`. Der Match muss die
Kommentare vorher entfernen —
`regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') !~* '(limit +1|order +by)'` —,
denn `pg_get_functiondef` liefert den Rumpf **inklusive** Kommentaren, und die normative
Begründung des F1-Designs nennt `order by … limit 1` wörtlich als das Ausgeschlossene
(Review-Befund: die naive Fassung ginge auf einer **korrekten** Implementierung rot und
belohnte das Löschen genau dieser Begründung). Dann Migration
schreiben (`supabase migration new …`, auf `_0019_` umbenennen), **`EXPECTED_TABLES` in
`0005_schema_meta_gate.sql` um beide Tabellen ergänzen** (einziger zulässiger Eingriff in eine
Bestandssuite). `db reset` ×2 → `supabase test db` grün.

**M2 — Contracts.** Rot: `packages/contracts/test/worksite-day.test.ts` (Duplikat-Paar
abgelehnt; überlappende Intervalle derselben Person abgelehnt; `2026-02-30` abgelehnt; Fenster
mit Team-Verweis auf unbekannte oder abweichende Assignment abgelehnt; `worksiteDays` bei
`sourceVersion: null` abgelehnt; **F:** zwei Team-Einträge mit verschiedenen Intervallen
parsebar; **DTO trägt stabile Id und Konfigurations-Id getrennt**). Der in Revision 3 hier
vorgesehene Konfliktcode-Paritätstest **entfällt**: `WORKSITE_DAY_INCOMPLETE` ist nach B.6 ein
Publish-Problem-Typ und erweitert die Konfliktcode-Listen nicht mehr. Er wäre in
`packages/contracts` ohnehin nicht schreibbar (das Paket hat keine Workspace-Abhängigkeit, und
`CONFLICT_CODES` liegt in `apps/api`); die in §0 gemessene Lücke bleibt als MISSING in §15
stehen, statt an ein Ticket gehängt zu werden, das sie nicht braucht. Dann Schemata, Port,
`http/planning-gateway.ts`, `mock`, `testing/…-contract.ts`, `document.ts`; `openapi:write`;
Drift-Test grün; `v1.json` committen. Gegenmutation: neue Route aus `document.ts` entfernen →
Konformitäts-/Drift-Test rot; zurücknehmen (scoped diff). **Zusätzlich Rot (M0, Contract-Hälfte):** beide Command-Schemata lehnen `team: []` ab, `WorksiteDayDtoSchema` akzeptiert es (die bewusst fehlende `.min(1)`, B.7).

**M3 — API `planWorksiteDay`.** `pnpm --filter @easytree/contracts build` (dist-Falle). Rot in
`planning-write.integration.test.ts`: Happy Path (Tag + 3 Personen, eine davon mit **zwei**
Intervallen → F; DTO mit `lockVersion 0`, stabiler Id und Konfigurations-Id), **B** (10 Personen,
Nr. 7 kollidiert → Identitäts-, Konfigurations- und Zuweisungszählung exakt wie vorher, je
einzeln gemessen), **I/J**, **K1** (Ergebnis-Reproduktion nach zwischenzeitlicher Änderung),
`DUPLICATE_WORKSITE_DAY`, `INTERVAL_OUTSIDE_DAY`, `OUTSIDE_WEEK`, **H** (fremde
Baustelle/Person ⇒ `RESOURCE_NOT_SELECTABLE`, identisch zu inaktiv), Kanalpositivfall über die
`easytree_app`-Verbindung mit Beobachterverbindung für Rohzählungen sowie die in M1
unerreichbaren Funktionszweige (`P0002` bei fremder Konfiguration, `23514` bei veröffentlichter
Zuweisung, inklusive Race gegen einen laufenden Publish). Eigene ISO-Woche je Suite. Dann
implementieren (inklusive `entwurfSicherstellen`-Extraktion und Exception-Rollback).
**Blocker 2 + F2 — Reorder und Helfer-Postcondition (gehören in M3, weil hier ohnehin
`entwurfSicherstellen` extrahiert wird):** (a) die eine Anweisung
`select app.lock_employee_planning($1)` wandert hinter den Entwurfsschritt, direkt vor den
Überlappungscheck; (b) die Draft-Auflösung wandert vollständig in die neue Domain-Funktion
`app.lock_week_draft(weekKey)` (B.2 Block 8) — `security definer`, mit Wiederholungsrunde.
Ein Invoker-`for share` im Anwendungscode genügt **nicht**: gemessen liefert er ohne
`planning.publish` **keine Zeile**, weil ein `for share` zusätzlich die USING-Klausel der
UPDATE-Policy prüft. Erst damit kehrt der Helfer in **allen** Pfaden mit gehaltenem
Klasse-(2)-Lock zurück (B.4.3). Rot zuerst: **O1** (existing-draft-Pfad, die Transaktion ist
nicht Insert-Gewinner) plus ein Ordnungs-Assert über die abgesetzten Queries (`for share` auf
`plan_versions` **vor** `lock_employee_planning`, dieses **vor** dem `during &&`-Select). Ein
Test, der nur den „neuer Draft"-Pfad abdeckt, genügt ausdrücklich **nicht**. Die Bestandssuiten von
`createAssignment` müssen unverändert grün bleiben — insbesondere die Serialisierung von
Prüfen-und-Einfügen (0012). **P3** (`app.read_idempotency_result` über den echten
`easytree_app`-Kanal mit `planning.write` ⇒ Replay liefert Ergebnis A) und **P1/F** (kein
Bestands-Idempotenzpfad regressiert: `createAssignment`- und `publishPlan`-Replay grün, beide
lesen weiterhin `subject_id`/`request_fingerprint` über den unveränderten Weg) laufen hier mit. Gegenmutationen: (a) Transaktionsklammer brechen → B rot; (b) internen Throw durch
`ok:false` ersetzen → B rot; (c) die Personensperre zurück vor den Entwurfsschritt schieben →
Ordnungstest rot **und** N3 (M4) meldet wieder `40P01`; (d) **den Helfer auf ein Invoker-`for share` im
Anwendungscode zurückdrehen ⇒ O1 rot** (unter `ohnePublishRecht` null Zeilen); (e) **die
Wiederholungsrunde aus `app.lock_week_draft` entfernen ⇒ der A1-Durchlauf von N6 rot** (der
Helfer liefert nach dem Publish-Commit keine Id).
Diese beiden Gegenmutationen tragen im Vertrag die Namen **GM-N6-1** (Personensperre zurück vor
den Entwurfsschritt) und **GM-N6-2** (Wiederholungsrunde entfernt). **N6 darf aus GM-N6-1 keinen
scheinbaren PASS ableiten:** „kein `40P01`" ist in **jedem** der vier N6-Durchläufe ein
PASS-Kriterium, nicht nur in N3/N3b — ein Durchlauf, der mit `40P01` endet, ist rot, auch wenn
die Fachwirkung danach plausibel aussieht.
**F3 — Mandantenbindung von `app.lock_week_draft` (gehoert in M3, weil O2 eine echte
Laufzeitidentitaet mit steuerbaren Mitgliedschaften braucht):** rot zuerst **O2a/O2b/O2c**
(Matrix §11), aufgebaut auf derselben Infrastruktur wie `ohnePublishRecht` — dort wird bereits
eine Sitzung mit gezielt beschnittenen Rechten hergestellt; O2c braucht zusaetzlich eine zweite
aktive Mitgliedschaft derselben Identitaet. Zaehlungen laufen ueber die Beobachterverbindung
(`postgres`), weil die Sitzung selbst nach dem `42501` in einer abgebrochenen Transaktion sitzt.
**Gegenmutation (f): die Exact-One-Aufloesung entfernen und die Mengenform aus Revision 7
wiederherstellen** (`insert … select o.id from public.organizations o where o.id in (select
app.user_org_ids())` und `pv.org_id in (select app.user_org_ids())`) ⇒ **O2b rot** (`55P03`
nach drei Runden statt `42501`), **O2c-Durchlauf 1 rot** (`P0003 query returned more than one
row` statt `42501`) und **O2c-Durchlaeufe 2 und 3 rot** — dort entsteht ein Entwurf in der
Organisation OHNE Entwurf und die Funktion gibt dessen Id als Erfolg zurueck (beides gemessen).
Bleibt O2 bei dieser Mutation gruen, misst der Test die Mandantengrenze nicht.
**M0 (Server-Hälfte für `planWorksiteDay`):** leeres Ziel-Team ⇒ 400 mit dem Typ `WORKSITE_DAY_TEAM_REQUIRED`, Zählungen `worksite_days`/`worksite_day_configurations`/`assignments` vorher == nachher.

**M4 — API `updateWorksiteDayTeam`.** Rot: **D** (Readback == bestätigter Serverstand; entfernte
Zeile weg; unveränderte Paare behalten Ids), **N1** (Verlierer `STALE_WORKSITE_DAY` **ohne**
ausgeführtes Delta), **N2a**, **N2b**, **N3** und **N3b** (nach dem Reorder aus B.4.3
**deadlockfrei**: beide Sessions terminieren, kollidierende Kombinationen liefern den
Domainkonflikt), **N4**, **N5**, **E** (Bearbeitung eines veröffentlichten Tages: neuer Draft, **gleiche**
`worksiteDayId`, neue `configurationId`, übernommener und dann erhöhter `lockVersion`;
veröffentlichte Zeilen unverändert), Guard 4b **unter `authenticated` mit entzogenem
`planning.publish`** (`ohnePublishRecht`-Infrastruktur) → weiterhin `23514`; **M0** (Server-Hälfte für `updateWorksiteDayTeam`): leeres Ziel-Team ⇒ 400 `WORKSITE_DAY_TEAM_REQUIRED` **ohne jede Mutation**
(Delta-Zählungen == 0); `WORKSITE_DAY_NOT_FOUND` für fremd == inexistent (H); **I/J/K1**; **K** (roher
`update`/`delete` auf `assignments` über die `easytree_app`-Verbindung scheitert weiterhin).
**N3/N3b laufen nach dem Reorder als echte, nach B.4.5 synchronisierte Parallelläufe und
dürfen KEIN `40P01` mehr zeigen** (Blocker 2): zwei getrennte Verbindungen, Haltepunkt vor dem
kritischen Lockschritt, Barriere, Timeout-gesichertes Einsammeln, `pg_stat_activity` ohne
wartende Session. Die Gegenmutation (Personensperre zurück vor `entwurfSicherstellen`) muss
beide **reproduzierbar rot** machen — sonst misst die Barriere nichts. Die
`40P01`→wiederholbarer-Fehler-Abbildung wird **separat** als Unit-Zusicherung der Route geprüft,
nicht als PASS-Kriterium von N3/N3b. **P4 (b)/(c):** eine Identität ohne `planning.write`
erhält `42501`, ein fremder Tenant `null` — beides über die Funktion, im Laufzeitkanal.
**P5 (F1, zwei Tenants):** derselbe `operation`/`idempotency_key` existiert in Org A und Org B
mit verschiedenen Payloads; jede autorisierte Runtime-Session erhält ausschließlich ihren
eigenen, eine dritte Organisation `null`. Beide Insert-Reihenfolgen werden gemessen, jede
Session zweimal aufgerufen. Gegenmutation: `org_id = v_org` aus der Payload-Abfrage entfernen ⇒
P5 rot.
Implementieren → grün. Gegenmutationen: (a) `and lock_version = $expected` entfernen → N1 rot;
(b) `security definer` aus Guard 4b entfernen (Wegwerf-Migration im lokalen Stack) →
`ohnePublishRecht`-Fall rot; (c) Replay auf Re-Read umstellen → K1 rot.

**M5 — Fenster-Lesepfad, Kopie und Publish-Vollständigkeit.** Rot: Fenster liefert
`worksiteDays` mit stabiler Id, Konfigurations-Id und Team; `NULL`-Zuweisung erscheint in
`assignments` und in keinem Team (**G**); **E vollständig** über den Lesepfad; **M** (der Publish-Riegel: eine
über die Beobachterverbindung künstlich erzeugte Konfiguration ohne Zuweisung lässt
`publishPlan` mit `WORKSITE_DAY_INCOMPLETE` scheitern; nach Ergänzen einer Zuweisung gelingt er
— der Riegel ist im Slice per Konstruktion unerreichbar und wird deshalb ausdrücklich künstlich
ausgelöst, statt ungeprüft zu bleiben); `publishedAssignments` liefert vorher == nachher dieselbe
Zeilenform (**L**-Basis). Implementieren (`planning-window.repository.ts`, Kopiererweiterung, **eigener**
Vollständigkeitsschritt in `publishPlan` samt neuem Problem-Kind und Controller-Mapping —
`blockierendeKonflikte` bleibt unangetastet, weil es zwingend `BLOCKING_CONFLICT` erzeugt). **N6** (`publishPlan` ↔ `createAssignment`, synchronisiert nach B.4.5): **vier Durchläufe —
A1, A2, B und C** (B.4.3), je mit benanntem Haltepunkt. In allen vier terminieren beide
Transaktionen, es gibt **kein** `40P01`, **kein** `23514` und keinen 500er, die veröffentlichten
Zeilen sind hinterher byte-gleich und es bleibt keine Teilwirkung. Ausgänge: A1 und A2 legen die
Zuweisung in den **Folgedraft** (Publish veröffentlicht den Vorgänger ohne sie); B veröffentlicht
**denselben** Draft **einschliesslich** der Zuweisung; C veröffentlicht **nichts** und liefert
den Bestands-409 (`STALE_VERSION` mit `aktuelleVersionId: null` auf einer Woche ohne Version).
**`23514` ist kein zulässiger N6-Ausgang** — die frühere Formulierung „Ergebnis ∈
{mitveröffentlicht, `23514` abgelehnt}" stammt aus dem Lockmodell **vor** F2 und ist mit der
Klasse-(2)-Serialisierung unvereinbar. Im A1-Durchlauf wird zusätzlich belegt, dass
`createAssignment` an Klasse (2) wartet und dabei **keinen** Employee-Lock hält (`pg_locks` ohne
Advisory-Eintrag der wartenden Transaktion); im B-Durchlauf, dass der Publisher an seinem
`for update` wartet. Gegenmutationen: (a) Vollständigkeitsprüfung entfernen → **M** rot;
(b) **GM-N6-3** — den Klasse-(2)-Lock im existing-draft-Pfad des Helfers auf ein plain `select`
degradieren ⇒ **N6-B rot** (der Publisher wartet nicht mehr, beide Seiten arbeiten auf demselben
Draft ohne Serialisierung) **und O1 rot** (Relationsmodus fällt auf `AccessShareLock`);
(c) im Spiegel-Trigger eine Zeilensperre auf fremde Zuweisungen erzwingen → N6 rot (belegt, dass
N6 den Lockgraphen wirklich abtastet).

**M6 — Web-Werkbank.** Rot: `wochenraster.test.ts` (Gruppierung, `NULL`-Rest, Tag ohne Team als Anomaliefall) +
`baustellentag-werkbank.test.tsx` — **A** (1 Baustelle, 10 Personen ⇒ genau **eine**
`data-worksite-day-id`-Karte mit 10 Teamzeilen), Öffnen per Klick **und** Tastatur, Speichern
sendet Ziel-Team + `expectedLockVersion`, 409 ⇒ Meldung + Nachladen, **F** (zwei verschiedene
Intervalle in einer Karte sichtbar — **Anzeige**, aus einer Fixture; die Slice-1-UI kann sie nicht eingeben), leeres Ziel-Team wird abgelehnt statt gesendet (B.6). Umbau nach
B.8. Vor dem Entfernen alter testids repo-weit greppen (Playwright läuft nicht in `pnpm test`);
Guards R1/R2 und a11y (fieldset/legend; `role="status"`-Kollision meiden) nachziehen.

**M7 — Reale Reise (auth-journey).** Schritt 9c1b ersetzen: W34 → „Baustellentag planen" →
Baustelle → 18.08.2026 → 07:00–15:00 → zwei Personen → Speichern (201) → genau **eine** Karte
(`[data-tag="2026-08-18"] [data-worksite-day-id]` count 1) mit beiden Namen → Karte per Tastatur
öffnen → eine Person abwählen → Speichern (200, `lockVersion` erhöht) → Reload identisch →
zweiter Browserkontext identisch (**gleiche stabile Tages-Id**) → Publish →
`data-stand=veroeffentlicht` → Sprint-6-Kostenschritte unverändert grün (**L** end-to-end).
Staging-Variante erst nach CI-Grün; Journey-Woche dort hochzählen (W35/W37/W38 verbraucht).
**Scope-Hinweis (R5-5):** die Reise gibt **ein** Initialintervall für zwei Personen ein und
belegt damit genau den Slice-1-Umfang. Sie zeigt **kein** individuelles Multi-Interval-
Authoring; dass Modell, Contract und Anzeige mehrere Intervalle tragen, belegt Test F.

**M8 — Abschluss.** Volle Gates (Prettier über `git ls-files`; `turbo lint/typecheck/test
--force`; `env -u EASYTREE_API_PROXY_TARGET pnpm build`; `db reset` ×2 + pgTAP); Evidenzpaket und
Parity-Matrix neu aus realem Lauf; Push; CI am exakten Head: 11/11 und alle db-gates-Zeilen
`mode=required … skipped=0` einzeln gelesen; PR-Beschreibung (compose → re-read → send);
Jira-Kommentar **erst nach Nutzerfreigabe**; Human-PO-Visual-Gate. Kein Merge ohne PO.

---

## 11. Error- und Regressionsmatrix (binär prüfbar)

| ID      | Szenario                                                                                                                                                                                                                                          | Erwartung                                                                                                                                           | Ort                                                           | Fertig-Kriterium                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A       | 1 Baustelle, 1 Tag, 10 Personen                                                                                                                                                                                                                   | genau eine Tageskarte, 10 Teamzeilen                                                                                                                | M6, M7                                                        | `[data-worksite-day-id]`-Count == 1; Teamzeilen == 10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| B       | Person 7/10 ungültig                                                                                                                                                                                                                              | 0 persistierte Änderungen                                                                                                                           | M3                                                            | Zählungen für `worksite_days`, `worksite_day_configurations`, `assignments` vorher == nachher, je einzeln                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **O1**  | **existing-draft-Lockordnung**: der Draft existiert **vor** `createAssignment`, die Transaktion ist also nicht Insert-Gewinner                                                                                                                    | Klasse (2) wird in `entwurfSicherstellen`/`app.lock_week_draft` erworben, **vor** `app.lock_employee_planning`; dieses vor Überlappungscheck/Insert | M3                                                            | (a) `pg_locks` zeigt für die Transaktion auf `public.plan_versions` den Relationsmodus **`RowShareLock`** (Gegenmutation plain `select` ⇒ `AccessShareLock`) plus einen `transactionid`-Eintrag der eigenen xid — Zeilensperren stehen im Tupel-Header, **nicht** als `locktype='tuple'`; (b) Ordnungs-Assert über die abgesetzten Statements: `app.lock_week_draft` **vor** `lock_employee_planning`, dieses **vor** dem `during &&`-Select; (c) die vom Helfer gelieferte Id ist die, in die eingefügt wird. **Zusätzlich unter `ohnePublishRecht`** (`planning.write` ohne `planning.publish`): der Helfer liefert die Draft-Id — die Invoker-Fassung lieferte dort gemessen **keine Zeile**. **Gegenmutationen:** Helfer auf Invoker-`for share` im Anwendungscode zurückdrehen ⇒ O1 rot; Wiederholungsschleife entfernen ⇒ A1-Durchlauf von N6 rot                                                                                                          |
| **O2a** | **F3 — genau eine Organisation**: Laufzeitsitzung mit exakt einer aktiven Mitgliedschaft in Org A, `planning.write` in A                                                                                                                          | `app.lock_week_draft` arbeitet ausschliesslich in A                                                                                                 | M3                                                            | gelieferte Id gehoert zu A (`select org_id … = A`); `plan_versions`-Zaehlung in A +1 (bzw. +0 bei bestehendem Entwurf), in jeder anderen Organisation Delta 0; die O1/F2-Locksemantik bleibt erfuellt (Relationsmodus `RowShareLock`, Erwerb vor `lock_employee_planning`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **O2b** | **F3 — keine Organisation**: Laufzeitidentitaet ohne aktive Mitgliedschaft                                                                                                                                                                        | `42501`, keine Wirkung                                                                                                                              | M3                                                            | SQLSTATE == `42501` (nicht `55P03`); Delta `plan_versions` == 0 ueber **alle** Organisationen (Beobachterverbindung, nicht die Sitzung selbst); kein Draft erzeugt, keiner gesperrt; die Schleife wird nie betreten (Fehler faellt vor Runde 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **O2c** | **F3 — mehrere Organisationen**: dieselbe Identitaet hat aktive Mitgliedschaften in A **und** B, `planning.write` in beiden, identischer `weekKey`. Drei Durchlaeufe: (1) A ohne / B ohne Entwurf; (2) A **mit** / B ohne; (3) A ohne / B **mit** | in allen drei Durchlaeufen `42501` — keine willkuerliche Auswahl                                                                                    | M3                                                            | je Durchlauf: SQLSTATE == `42501`; Delta `plan_versions` in A == 0 **und** in B == 0 (je Organisation einzeln gezaehlt, nicht als Summe — Netto-Zaehlungen heben sich auf); bestehende Entwuerfe byte-gleich (`id`, `lock_version`, `published_at` unveraendert); der Command antwortet als **Fehler**, nicht als Erfolg                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| C/N1    | zwei Team-Updates, gleicher `expectedLockVersion`                                                                                                                                                                                                 | ein Gewinner; Verlierer `STALE_WORKSITE_DAY` ohne Delta                                                                                             | M4                                                            | Verlierer `ok:false`, `aktuelleLockVersion == n+1`; DB-Team == Gewinnerstand; Verlierer-Deltas == 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D       | Person aus Draft-Team entfernt                                                                                                                                                                                                                    | Readback == bestätigter Serverstand                                                                                                                 | M4, M7                                                        | Antwort-Team == DB-Team == UI nach Reload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| E       | veröffentlichter Tag wird bearbeitet                                                                                                                                                                                                              | Historie unverändert; neue Revision, **gleiche** stabile Id                                                                                         | M4, M5                                                        | veröffentlichte Zeilen byte-gleich; `worksiteDayId` vorher == nachher; `configurationId` verschieden                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F       | mehrere Personen, verschiedene Intervalle am selben Tag; auch zwei Intervalle **derselben** Person                                                                                                                                                | Modell/Contract/API nehmen sie an; kein Constraint erzwingt Gleichheit; die Karte **zeigt** beide                                                   | M1, M2, M3, M6                                                | Insert zweier ungleicher Intervalle unter derselben Konfiguration gelingt; DTO parsebar; UI rendert beide Team-Einträge. **Nicht** geprüft und **nicht** behauptet: Eingabe mehrerer/individueller Intervalle über die Slice-1-UI (EYT-121)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| G       | Legacy-Zuweisung ohne Konfigurationsbezug                                                                                                                                                                                                         | bestehender Read bleibt; Einzel-Fallback sichtbar                                                                                                   | M5, M6                                                        | Zeile in `assignments`, in keinem Team; Fallback-Karte gerendert                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| H       | Cross-Tenant Worksite/Employee/WorksiteDay/Konfiguration                                                                                                                                                                                          | deterministische Ablehnung ohne Leak                                                                                                                | M3, M4                                                        | fremd == inexistent: identischer Problem-Typ **und** identischer Wortlaut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| I       | gleicher Key + identischer Payload                                                                                                                                                                                                                | keine Doppelwirkung                                                                                                                                 | M3, M4                                                        | `replayed: true`; Zeilenzahlen unverändert                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| J       | gleicher Key + anderer Payload                                                                                                                                                                                                                    | deterministische Ablehnung                                                                                                                          | M3, M4                                                        | 409 `IDEMPOTENCY_KEY_REUSED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **K1**  | K1 → Zustand A / Ergebnis A; K2 → Zustand B; Retry K1                                                                                                                                                                                             | Ergebnis A, **nicht** Zustand B                                                                                                                     | M3, M4                                                        | Antwort gleich Ergebnis A (tiefe Gleichheit nach `WorksiteDayDtoSchema.parse` — `jsonb` normalisiert die Schlüsselreihenfolge, Byte-Gleichheit des Körpers wäre kein erreichbares Kriterium); `replayed: true`; `lock_version` vor == nach dem Retry; Zeilenzahlen `worksite_days`/`worksite_day_configurations`/`assignments` vor == nach, je einzeln; `WorksiteDayDtoSchema.parse(result_payload)` wirft nicht (Gegenmutation: eine flache Team-Zeile ohne `interval` speichern ⇒ K1 rot)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **P1**  | payloadloser Bestandspfad: `select subject_id, request_fingerprint …` als `authenticated`                                                                                                                                                         | unverändert lesbar                                                                                                                                  | M1 (pgTAP) + M3                                               | `has_column_privilege('authenticated','public.idempotency_records','subject_id','SELECT')` **true**, dito `request_fingerprint`; Replay der vier Bestandsvorgänge grün                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **P2**  | `result_payload` direkt lesen — als `authenticated`, gleichgültig ob im Kanal oder nicht                                                                                                                                                          | **nicht** lesbar                                                                                                                                    | M1 (pgTAP)                                                    | `has_column_privilege('authenticated','public.idempotency_records','result_payload','SELECT')` **false**; ein `select result_payload …` als `authenticated` scheitert mit `42501`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **P3**  | `app.read_idempotency_result(op, key)` über den echten `easytree_app`-Kanal mit `planning.write`                                                                                                                                                  | liefert Ergebnis A                                                                                                                                  | M3/M4 (Integration)                                           | Rückgabe deep-equal zum gespeicherten Payload; Replay der neuen Commands grün                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **P4**  | dieselbe Funktion (a) außerhalb des Laufzeitkanals, (b) ohne `planning.write`, (c) mit fremdem Tenant, (d) mit fremder Operation                                                                                                                  | (a)/(b)/(d) `42501`, (c) `null`                                                                                                                     | M1 (a/d als `postgres`) + M4 (b/c)                            | vier Fälle einzeln gemessen — **und je mit dem Meldungstext**, nicht nur dem SQLSTATE: (a) `'Nur der Laufzeitkanal darf ein Replay-Ergebnis lesen'`, (d) `'Kein Payload-Vorgang'`. Grund (Review-MESSUNG): in der M1-Umgebung enden alle drei ersten Riegel in `42501`; eine reine `throws_ok(…, '42501')`-Zusicherung blieb bei gelöschtem Operations- bzw. Kanalriegel **grün** — der jeweils nächste Riegel fing den Fall ab. Gegenmutation je Fall: den geprüften Riegel löschen ⇒ Meldungstext ändert sich ⇒ rot. (c) liefert `null` statt eines Fehlers — fremd == inexistent                                                                                                                                                                                                                                                                                                                                                                              |
| **P5**  | **gleicher `operation` + gleicher `idempotency_key` in Org A und Org B**, Payload A ≠ Payload B                                                                                                                                                   | jede Session sieht ausschließlich ihren eigenen Payload; Dritte `null`                                                                              | M4 (Integration, zwei Tenants)                                | Session A ⇒ Payload A, Session B ⇒ Payload B, Session C (weder A noch B) ⇒ `null`; Ergebnis unabhängig von der Insert-Reihenfolge (beide Reihenfolgen gemessen); je Session zweimal aufgerufen ⇒ identisches Resultat; **kein** Cross-Tenant-Payload in irgendeiner Antwort. Gegenmutation: `org_id = v_org` aus der Abfrage entfernen ⇒ P5 rot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| K       | direkter `authenticated`-UPDATE/DELETE auf `assignments` **und** jeder definer-Schreibpfad                                                                                                                                                        | verboten bzw. auf die benannte Funktionsmenge begrenzt (0017 unangetastet)                                                                          | pgTAP 0012 (unverändert) + neue Katalog-Zusicherung (M1) + M4 | 0012 A1/A2/B1/C2/C3 grün; roher UPDATE/DELETE über `easytree_app` scheitert; **genau eine** `prosecdef`-Funktion mit `delete from public.assignments` im Quelltext, und das ist `app.remove_assignment_from_worksite_day`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| L       | Kosten-/Publish-Projektion                                                                                                                                                                                                                        | konkrete veröffentlichte Assignments; Snapshots nicht reinterpretiert                                                                               | M5, M7, Diff                                                  | `git diff origin/master...HEAD -- apps/api/src/modules/costs packages/contracts/src/costs` leer; CI-Kostengates grün                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **M0**  | Command mit leerem Ziel-Team (beide Commands)                                                                                                                                                                                                     | Ablehnung `WORKSITE_DAY_TEAM_REQUIRED` auf Contract- **und** Serverebene, ohne jede Mutation                                                        | M2 (Schema), M3/M4 (Server)                                   | Zod lehnt `team: []` ab; HTTP antwortet 400 mit `type` = `WORKSITE_DAY_TEAM_REQUIRED` (nicht dem generischen Parse-Fehler); Zeilenzahlen `worksite_days`/`worksite_day_configurations`/`assignments` vorher == nachher, je einzeln                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **M**   | Version mit einer Tageskonfiguration ohne Zuweisung veröffentlichen (künstlich über die Beobachterverbindung erzeugt)                                                                                                                             | Ablehnung `WORKSITE_DAY_INCOMPLETE`; nach Ergänzen einer Zuweisung erfolgreich                                                                      | M5                                                            | erster Publish `ok:false` mit dem Problem-Typ; zweiter `ok:true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **N2a** | Publish committet, BEVOR das Team-Update seine Konfiguration auflöst                                                                                                                                                                              | Team-Update **gelingt** gegen den neuen Folgedraft                                                                                                  | M4                                                            | `worksiteDayId` unverändert; `configurationId` neu; veröffentlichte Zeilen byte-gleich                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **N2b** | Team-Update hält Klasse (2), Publish will `for update`                                                                                                                                                                                            | Publisher wartet; nach dem Commit des Team-Updates veröffentlicht er den fertigen Stand                                                             | M4                                                            | Publisher blockiert nachweislich (`pg_stat_activity`: `wait_event_type='Lock'`); kein `40P01`; Team-Update `ok:true`; die veröffentlichte Version enthält dessen Änderung; **kein** `23514`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **N3**  | Team-Update ↔ `createAssignment` (gleiche Person), **synchronisiert nach B.4.5**                                                                                                                                                                  | kein Deadlock; kein Teilzustand; kein Lost Update                                                                                                   | M4                                                            | zwei Verbindungen, Barriere gelöst, beide Ergebnisse innerhalb des Timeouts; **kein `40P01`**, kein 500er; zulässige Kombination: beide `ok:true`; kollidierende: genau ein `ok:false` mit `OVERLAPPING_ASSIGNMENT`; `pg_stat_activity` ohne wartende Session; **Gegenmutation (alte Lockreihenfolge) macht ihn rot**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **N3b** | `planWorksiteDay` ↔ `createAssignment` (gleiche Person, Woche ohne Draft), **synchronisiert nach B.4.5**                                                                                                                                          | wie N3, zusätzlich genau ein Entwurf                                                                                                                | M4                                                            | wie N3; zusätzlich genau **eine** `plan_versions`-Zeile mit `published_at is null`, Kopie genau einmal ausgeführt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **N6**  | `publishPlan` ↔ `createAssignment` (gleiche Woche), **synchronisiert nach B.4.5**, je ein Durchlauf für **A1, A2, B und C** (B.4.3)                                                                                                               | kein Deadlock; veröffentlichte Zeilen unverändert; keine Teilwirkung                                                                                | M5                                                            | **kein `40P01`**, **kein `23514`**, kein 500er — `23514` ist nach F2 in keinem der vier Fälle ein zulässiger Ausgang und macht N6 rot. A1: der Helfer liefert nach dem Publish-Commit über die Wiederholungsrunde einen **Folgedraft**, die Zuweisung landet dort, der wartende `createAssignment` hält dabei **keinen** Advisory-Lock. A2: `createAssignment` wartet am Index-Tupel und wird danach Insert-Gewinner genau eines Folgedrafts. B: der Publisher wartet belegbar an seinem `for update`, danach wird **derselbe** Draft **mitsamt** der neuen Zuweisung veröffentlicht. C: Publish findet keinen Draft und antwortet 409 `STALE_VERSION` mit `aktuelleVersionId: null` (bzw. `ALREADY_PUBLISHED`, wenn die Woche schon eine veröffentlichte Version trägt) — **veröffentlicht nichts**; die Zuweisung landet im neuen Draft. In allen vier Durchläufen: veröffentlichte Zeilen byte-gleich, `pg_stat_activity` nach Testende ohne wartende Session |
| **N4**  | Team-Update ↔ `planWorksiteDay` (gleiche Identität)                                                                                                                                                                                               | `DUPLICATE_WORKSITE_DAY`                                                                                                                            | M4                                                            | genau eine Konfigurationszeile je (Version, Tag)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **N5**  | zwei Commands kopieren gleichzeitig den Draft                                                                                                                                                                                                     | genau eine Kopie                                                                                                                                    | M4                                                            | genau **eine** `plan_versions`-Zeile mit `published_at is null` für die Woche; für jede `worksite_day_id` des veröffentlichten Stands **genau eine** Konfigurationszeile im Draft (gezählt, nicht behauptet); Zahl der aus der Kopie stammenden Assignments == Zahl im veröffentlichten Stand (gemessen über die Zeilen ohne Delta-Beteiligung)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Ergänzend die in M2–M5 benannten Gegenmutationen — jeweils eingespielt, rot gemessen,
zurückgenommen, Rücknahme per scoped `git diff` belegt.

---

## 12. Rollback und Forward-Fix

Migration rein expandierend. Kosten-Snapshots und der Employee-Vertrag bleiben in jedem
Rücknahmepfad vollständig; für die veröffentlichte Planungswahrheit gilt die zeitliche Grenze
aus B.9: verlustfrei nur, solange keine konfigurationsgebundene Woche veröffentlicht wurde. Das
STOP-Kriterium „destructive migration" ist nicht berührt — die Migration selbst zerstört nichts;
nur ihre spätere Rücknahme hätte den benannten, dokumentierten Preis. Produktionsvorsicht: die
Supabase-GitHub-Integration migriert beim master-Merge automatisch (Merge = Produktivmigration)
→ Merge nur nach PO-Gate und grünem CI.

---

## 13. Traceability

| Ticket / Quelle                     | Verhältnis                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EYT-125**                         | Teil A ist die geforderte Architekturentscheidung (Entitäten, Identität vs. Revision, Default/Snapshot/Override, Preview/Apply/Submit/Publish, Audit-/Event-/Idempotenzgrenzen, Kostenquelle, Fehlercodes, Migrationsstufen). Teil B ist die kleinste kompatible Untermenge. `derived_noncanonical` bis zur Orchestrator-Freigabe                                           |
| **EYT-147**                         | kanonisch **durch EYT-125 blockiert**; M1–M8 ist der Reparaturpfad                                                                                                                                                                                                                                                                                                          |
| **EYT-119**                         | Epic-Richtung; Teil A entscheidet es vollständig, Teil B baut das Fundament                                                                                                                                                                                                                                                                                                 |
| **EYT-120**                         | Zeitraum, Default, Snapshot, Generator — A.4/A.9, Stufe 0020                                                                                                                                                                                                                                                                                                                |
| **EYT-121**                         | stabile Tagesidentität (R-01) und Concurrency (R-09) im Slice; Tagesstatus und Hinweise plus `setWorksiteDayStatus` in Stufe 0021. Tätigkeiten und Ressourcen sind **nicht** Teil von EYT-121 — A.7/A.9 führen sie unter „später" (EYT-16 / Ressourcen-Ticket); zusätzlich das **UI-Authoring individueller/mehrerer Intervalle je Person** im Bearbeitungs-Inspector (B.8) |
| **EYT-122**                         | Vorschau und Serienanwendung auf `worksiteDayIds[]` — adressierbar durch B1 (A.2)                                                                                                                                                                                                                                                                                           |
| **EYT-123**                         | Einreichen (Stufe 0023); Publish im Slice um die Vollständigkeitsregel erweitert                                                                                                                                                                                                                                                                                            |
| **EYT-72 / 38993921 §12 / 9306113** | sichtbare Baustelleneinheit durch M6/M7                                                                                                                                                                                                                                                                                                                                     |
| **EYT-16**                          | Grenze respektiert; Worksite-Create und Tätigkeiten bleiben dort                                                                                                                                                                                                                                                                                                            |
| **EYT-92**                          | Idempotenzvertrag; der Slice erweitert ihn additiv um `result_payload` (B.5)                                                                                                                                                                                                                                                                                                |
| **EYT-107 / EYT-136**               | Kanal- und Mandantengrenze der Planungsschreibflaeche (0015-0017). F3 zieht dieselbe Grenze in `app.lock_week_draft`: `security definer` umgeht RLS, also bindet die Funktion selbst an genau eine aktive Organisation — belegt durch **O2a-O2c** (§11)                                                                                                                     |

---

## 14. PR-#101-Inventar

**PRESERVE:** Werkbank-Shell (`planungs-werkbank.tsx`), `wochen-navigation.tsx`,
`planung-ansicht.tsx`, `planung-zugang.tsx`, `planning-publish-action.tsx` samt Tests,
Inspector-Fokus- und Escape-Mechanik, `globals.css`-Werkbank- und Tokenarbeit,
`werkbank-oberflaechenguards.test.tsx` (R1/R2), `werkbank-serverwahrheit.test.tsx`, `zeitText`,
`data-stand`-Zustandsanzeige, e2e-Infrastruktur.

**ADAPT:** `lib/wochenraster.ts`, `planning-window-view.tsx`, `dispositionswerkbank.test.tsx`,
`wochenraster.test.ts`, Journey-Schritt 9c1b, `ui-parity-matrix.md`.

**REPLACE:** `planning-assignment-form.tsx` als Werkbank-Formular → `worksite-day-form.tsx`.

**REMOVE (regenerieren, nicht fortschreiben):**
`docs/evidence/2026-08-31-eyt-147-slice-1/`-Screenshots und die README-Aussagen des
Karte-je-Assignment-Modells.

---

## 15. Offene Punkte

| Klasse                                       | Punkt                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ASSUMPTION                                   | `app.has_permission`/`app.user_org_ids` sind aus definer-Kontext sitzungsbezogen auswertbar — Präzedenz `app.reject_assignment_in_published_plan` (0015/0016); `app.lock_employee_planning` ist **keine** Präzedenz (INVOKER). Wird in M3/M4 gemessen                                                                                                                                                                                                                |
| ASSUMPTION                                   | Ein Tabellen-Grant deckt eine später hinzugefügte Spalte mit ab — das gilt nach R5-1 nur noch für **INSERT** auf `idempotency_records`; das SELECT-Tabellenrecht ist entzogen und spaltenweise neu vergeben. M1 misst beides über `has_column_privilege`                                                                                                                                                                                                             |
| MISSING (§0-Befund, bewusst nicht angehängt) | Ein Wächter „jeder Domaincode aus `CONFLICT_CODES` hat eine Entsprechung in `CONFLICT_CODE_VALUES`" existiert entgegen CLAUDE.md nicht. Nach der B.6-Entscheidung braucht der Slice ihn nicht mehr; er gehört in ein eigenes Ticket nach `apps/api/test/` — in `packages/contracts` ist er mangels Workspace-Abhängigkeit nicht schreibbar                                                                                                                           |
| MISSING (Bestandslücke, gemessen)            | 0012 A1/A2/B1/C2/C3 sind gegenüber `security definer`-Schreibpfaden strukturell blind. M1 schließt das für `assignments` mit einer Katalog-Zusicherung; für die übrigen Tabellen bleibt die Lücke offen und gehört in ein eigenes Ticket                                                                                                                                                                                                                             |
| MISSING (Bestandslücke, am Code verifiziert) | `costs.create_rate_version` verletzt R-21 bereits heute: sein Replay liest die `employee_rate_versions`-Zeile erneut, deren `valid_to` die nächste Ablösung setzt (`rate-repository.pg.ts` :222–225 vs. :295–297) — ein Retry liefert dort nicht die Erstantwort. Dieser Slice verursacht und behebt das nicht; eigenes Ticket                                                                                                                                       |
| ASSUMPTION                                   | Delta-Identität `(employeeId, interval)` genügt Slice 1; sobald eine Zuweisung eigene mutierbare Felder erhält, adressiert das Delta über `assignmentId` (im DTO bereits vorhanden)                                                                                                                                                                                                                                                                                  |
| MISSING (DEFERRED, in Teil A entschieden)    | Zeitraum, Default, Snapshot, Generator, Serienanwendung und Vorschau, Tagesstatus, Tätigkeiten, Ressourcen, Einreichen, Tag-Löschen, Tag-Adoption, `/einsatz/*`, `createAssignment`-Stilllegung                                                                                                                                                                                                                                                                      |
| ASSUMPTION (in M3 zu messen)                 | Der Reorder von `createAssignment` ist semantikerhaltend, weil der Advisory-Lock laut 0012 ausschließlich Prüfen-und-Einfügen serialisiert und zwischen Sperre und Überlappungscheck nichts liegt. M3 misst es doppelt: Bestandssuiten grün **und** ein Ordnungstest über die abgesetzten Statements                                                                                                                                                                 |
| MISSING (Bestandslücke, gemessen)            | `app.lock_idempotency_key` (0012:200) löst die Organisation mit `select id into v_org from public.organizations order by id limit 1` auf und ist **nicht** `security definer` — dieselbe Regel, die F1 für die Lesestelle setzt, gilt für die Sperre desselben Ablaufs also nicht. Hinter der Single-Organisation-Prüfung des Repositories praktisch unerreichbar, deshalb kein Slice-Blocker; wird hier benannt statt wegdefiniert und gehört in ein eigenes Ticket |
| BLOCKER                                      | keiner im Sinne der STOP-Bedingungen                                                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## 16. Schlussformeln

**ARCHITECTURE VERDICT:**
VARIANTE B1 (A.2) — getrennte, versionsübergreifend stabile Tagesidentität (`worksite_days`) plus
revisionsgebundene Tageskonfiguration (`worksite_day_configurations`), ohne eigene Zeiten und
ohne eigenen Publish-Marker; Assignments bleiben untergeordnete materialisierte Zuweisungen mit
eigenen Intervallen und die einzige Publish-, Kosten-, Konflikt- und Employee-Quelle; Entfernen
ausschließlich über die fachlich gebundene Domain-Funktion; 0017 unangetastet.

**PLAN VERDICT:**
READY_FOR_ORCHESTRATOR_REVIEW

**IMPLEMENTATION STATUS:**
NOT_STARTED

**EYT-147 MERGE STATUS:**
BLOCKED
