# EasyTree-Adapter fuer den Delivery Readiness Standard (DRS) v1.0

Jira: **EYT-162**, Slice 1 — _Shadow Contract + lokaler Validator_.

Dieses Verzeichnis haelt den **abgeleiteten** Delivery-Contract von EasyTree.
Es ist ein Adapter an einen gemeinsamen Referenzstandard, kein zweiter
Standard und keine zweite Produktwahrheit.

## Governance-Entscheidung (Human PO, 07.09.2026)

`DRS_OWNERSHIP_DECISION = SHARED_REFERENCE_SEMANTICS`

- EasyTree **konsumiert** DRS v1.0 als gemeinsamen Referenzstandard.
- EasyTree baut **keinen** konkurrierenden DRS-Standard.
- `PLUM-36` / Confluence `49283074` bleibt `RELATED / ARCHITECTURAL_REFERENCE`.
- Plumbline ist **keine** Laufzeitabhaengigkeit von EasyTree.
- Der Stock-DRS-`install.sh` wird ausdruecklich **nicht** ausgefuehrt.

Referenzquelle, am 07.09.2026 gegen die GitHub-API geprueft:
`DYAI2025/DRS`, `main` = `c4efb97931c6171563191afb74d61507e13bc6d4`,
veroeffentlichtes v1.0-Artefakt-Blob `5848aef30de9262fb59a12a42b22301b9214941c`
(15844 Byte). Geprueft wurde die **Existenz und Identitaet** dieser Objekte,
nicht ihr Inhalt.

## Autoritaetskette

```
PRODUKTWAHRHEIT (PRD, Confluence, Human PO, Jira-Akzeptanzkriterien)
        |
        v
EASYTREE DRIFT_GATE
        |
        v
ABGELEITETER DELIVERY CONTRACT   <-- dieses Verzeichnis
        |
        v
IC / R2G / R4M DELIVERY READINESS
```

Der Vertrag ist eine **abgeleitete Projektion**. Er ersetzt nicht:

- Jira-Akzeptanzkriterien,
- Confluence-Produktwahrheit,
- Human-PO-Entscheidungen,
- GitHub-Delivery-Wahrheit,
- Merge-Autoritaet.

Ein gruener Vertrag ist **kein Abnahmebeleg**. Deshalb traegt jede Ausgabe des
Validators `authoritative=no`, und `known_boundaries` ist ein Pflichtfeld: der
Vertrag muss seine eigenen Grenzen mitfuehren.

## Dateien

| Datei                                         | Zweck                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `.drs/schema/delivery-contract.v1.json`       | Deklarative, maschinenlesbare Feldbeschreibung (Struktur)                   |
| `.drs/contracts/EYT-162.contract.json`        | Der EYT-162-Vertrag: SHADOW, NON_AUTHORITATIVE, NOT_ACCEPTED                |
| `scripts/drs/contract-model.mjs`              | Interpretiert die Feldbeschreibung (Strukturpruefung, strikt)               |
| `scripts/drs/contract-invariants.mjs`         | Registry der feldruebergreifenden Invarianten, je mit stabiler ID und Zweck |
| `scripts/drs/validate-contract.mjs`           | CLI, fail closed: 0 = keine Befunde, 1 = Befunde, 2 = nicht pruefbar        |
| `scripts/drs/test/validate-contract.test.mjs` | `node:test`-Suite: Positivfall plus je ein roter Fall pro Invariante        |

## Ausfuehren

```bash
node scripts/drs/validate-contract.mjs .drs/contracts/EYT-162.contract.json
node --test scripts/drs/test/validate-contract.test.mjs
```

Beides braucht **nur Node 22** (`.nvmrc`) — keine Installation, keine neue
Abhaengigkeit. `node:test` statt Vitest, weil alle Vitest-Projekte dieses
Repositories in `apps/*` und `packages/*` liegen und beide Flaechen fuer
EYT-162 Slice 1 gesperrt sind.

**Achtung:** `node --test <verzeichnis>` loest den Pfad als Modul auf und
scheitert mit `MODULE_NOT_FOUND`, bevor ein Test laeuft. Immer die **Datei**
uebergeben.

## Semantik

Lieferzustand (`state`): `CONTRACT` → `IN_PROGRESS` → `IC` → `R2G` → `R4M` → `MERGED`.
Gate-Zustand: `NOT_EVALUATED` | `PASS` | `FAIL` | `INVALIDATED` | `NOT_APPLICABLE`.

`INVALIDATED` ist ein **erstklassiger** Zustand, nicht das Fehlen von `PASS`:
er verlangt Begruendung und Zeitpunkt, und solange er gilt, darf kein Gate
gruen stehen.

Die 16 Invarianten stehen mit ID und Begruendung in
`scripts/drs/contract-invariants.mjs`. Jede wird von genau einem Testfall rot
gemacht; die Suite vergleicht Registry und Abdeckung und wird rot, sobald eine
Invariante ohne Test dazukommt.

## Grenzen dieses Slices — was hier NICHT geloest ist

Slice 1 prueft die Vertragsstruktur im SHADOW-Modus. Er liefert **noch keine**
agentenunabhaengige Durchsetzung, keine CI-Autoritaet, keine Frischepruefung
der Quellen und keinen Schutz gegen Selbstzertifizierung.

Im Einzelnen:

- **`NO_CI_ENFORCEMENT`** — der Validator laeuft nur lokal. Kein CI-Job, kein
  Required Check, keine Ruleset-Aenderung.
- **`NO_INDEPENDENT_ACCEPTOR`** — es gibt keine unabhaengige Acceptor-Instanz.
  `acceptance_authority.resolution` ist deshalb `UNRESOLVED`; ein erfundener
  Name waere eine erfundene Autoritaet.
- **`NO_SOURCE_FRESHNESS_ENFORCEMENT`** — `source_bindings` traegt
  Beobachtungszeitpunkte, aber nichts prueft, ob Jira oder Confluence sich
  seither geaendert haben. Ein veralteter Vertrag faellt hier nicht auf.
- **`NO_AGENT_HOOK_PARITY`** — keine Claude-Hooks, keine Codex-Konfiguration,
  kein Paritaetsnachweis zwischen Agenten.
- **`NO_MERGE_BLOCKING`** — nichts hier blockiert einen Merge.
- **`BRANCH_OWNED_CONTRACT_IS_NOT_ACCEPTANCE_EVIDENCE`** — der Vertrag liegt
  auf dem Branch des Implementierers und ist von ihm schreibbar. Die
  Invariante `acceptance-authority-not-implementer` faengt die
  **ausgeschriebene** Selbstzertifizierung (`asserted_by_implementer`, oder
  ein Acceptor identisch mit dem Implementierer); sie faengt **nicht** die
  Schreibrechte. Die Trennung von Acceptor und Implementierer gehoert in einen
  spaeteren EYT-162-Slice.
- **`NO_DIFF_SCOPE_GATE`** — `allowed_paths` und `forbidden_paths` werden nur
  auf **Syntax** geprueft. Niemand vergleicht sie mit einem echten Diff.

Diese Liste ist kein Kommentar, sondern durchgesetzt: die Invariante
`slice-1-declares-known-boundaries` macht einen Vertrag rot, der eine der
ersten sechs Grenzen verschweigt.

## Rollback

Loeschen von `.drs/` und `scripts/drs/` stellt exakt den vorherigen Zustand
her. Es gibt keine Migration, keine Produktdaten, keinen CI-Bezug und keinen
Eintrag in einer required-Checks-Liste.
