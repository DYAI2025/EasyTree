# EYT-126 — der Containerpfad liegt ausserhalb der armierten Sprint-6-Scope

> **Status: `ENTSCHEIDUNG_OFFEN`.** Dieses Dokument entscheidet nichts. Es macht eine
> PO-Entscheidung in einem Schritt ausführbar und belegt, warum sie nötig ist.

## Der Befund

Der PRIL-Scope-Gate (`scripts/plumbline-scope-guard.sh` → `plumbline-scope-check`) meldet
`PRIL_POLICY_VIOLATION`, `exit_code=3`. Ursache ist **keine** Nachlässigkeit im Slice, sondern
eine ausdrückliche Festlegung im Manifest selbst. Revision 1 von
`docs/scope/easytree-sprint-6-core-journey.scope.json` sagt wörtlich:

> „Infrastruktur-, API- und supabase-Pfade fuer Slice 0/3 bewusst NICHT enthalten."

EYT-126 ist genau so ein Infrastrukturpfad. Der Slice kann die Regel nicht einhalten, ohne
aufzuhören, das zu sein, was er ist: ein `Dockerfile` muss unter `apps/api/Dockerfile` liegen, ein
CI-Schritt unter `.github/workflows/ci.yml`.

## Gemessen, nicht behauptet (21.08.2026)

Zwei getrennte Befunde. Nur der zweite gehört diesem Slice.

| Oberfläche                                                             | Dateien | davon ausserhalb der Scope |
| ---------------------------------------------------------------------- | ------- | -------------------------- |
| **A** — bereits auf `origin/master`, gegen die armierte Base `f3b427d` | 82      | **28**                     |
| **B** — nur die Commits dieses Slice (`origin/master...HEAD`)          | 16      | **11**                     |

**Befund A ist älter als dieser Slice.** Die armierte Base `docs/context/.scope-base` steht auf
`f3b427d` und liegt **78 Commits hinter `origin/master`**. Seither wurden EYT-140, EYT-141,
EYT-106 und die EYT-142-Phase-A gemergt — mit `eslint.config.mjs`, `package.json`,
`pnpm-lock.yaml`, `turbo.json` und weiteren Pfaden, die das Manifest nicht führt. Der Gate war
also **vor** diesem Slice bereits rot, und er meldet bei jedem Lauf 102 statt 29 Dateien.

Nachprüfbar ohne Checkout:

```bash
git rev-list --left-right --count f3b427d...origin/master   # -> 0  78
PLUMBLINE_SCOPE_BASE=origin/master bash scripts/plumbline-scope-guard.sh
```

**Befund B — die elf Dateien dieses Slice:**

```
.dockerignore
.github/workflows/ci.yml
apps/api/Dockerfile
apps/api/test/architecture/deploy-authority-rules.ts
apps/api/test/deploy-authority.test.ts
apps/web/Dockerfile
apps/web/next.config.ts
docker-compose.yml
docs/runbooks/staging-deploy.md
scripts/smoke-container.sh
turbo.json
```

## Warum das Manifest nicht von hier aus geändert wird

`docs/scope/**` steht in der Governance-Scope — mechanisch **könnte** dieser Slice das Manifest
also editieren. Er tut es nicht, aus zwei Gründen:

1. **Ein Manifest autorisiert nie seine eigene Änderung.** Die Bindung unter
   `.plumbline/scope-authority/easytree-sprint-6-core-journey.json` trägt den Digest
   `8032224886184ed81e668c0a9072ba255aa4cf7d05fe343117e22278c24f031c`, und
   `shasum -a 256 docs/scope/easytree-sprint-6-core-journey.scope.json` liefert **exakt denselben
   Wert** (gemessen 21.08.2026). Die Bindung ist scharf; jede Manifeständerung erzeugt
   `SCOPE_AUTHORITY_CHANGED` und muss ausdrücklich neu gebunden werden.
2. **Jede der vier bestehenden Revisionen trägt eine Person.** `decision_maker: Product Owner
Benjamin Poersch`, ein `decided_at`, eine `rationale` und `confirmed: true`. Eine Revision 5
   mit demselben Namen zu schreiben, ohne dass diese Entscheidung gefallen ist, wäre keine
   Dokumentation, sondern eine gefälschte Freigabe.

## Was der Gate NICHT blockiert

Der PRIL-Gate läuft als lokaler Stop-Hook, **nicht** in CI: `grep -c plumbline
.github/workflows/ci.yml` → `0`. Alle **11 Pflichtchecks** sind am Head
`ea9a392ca3e6755659e8b93f69078fd44e434f85` grün (Lauf 32498237919), PR #89 steht auf
`mergeState=CLEAN`. Der rote Gate hindert also nicht den Merge — er hindert die Aussage „fertig".
Das ist der Unterschied, den dieses Dokument offenhalten soll.

## Zwei Wege, beide brauchen den PO

### Weg 1 — Revision 5 des bestehenden Manifests

Die Sprint-6-Scope wird um die Deploymentpfade erweitert. Vorteil: eine Autorität, ein Ledger.
Nachteil: das Manifest beschreibt danach zwei verschiedene Arten von Arbeit.

Der Block, der nach Bestätigung in `provenance` gehört — **`confirmed` steht bewusst auf `false`
und `decision_maker` ist offen; beides füllt die Entscheidung, nicht dieser Entwurf:**

```json
{
  "revision": 5,
  "origin": "ENTWURF — offen. Auslöser: EYT-126 Containerpfad (Confluence 30998530) und PR #89.",
  "decision_maker": "<offen>",
  "decided_at": "<offen>",
  "rationale": "Revision 5 nimmt die Deploymentpfade auf, die Revision 1 ausdrücklich ausgeschlossen hatte ('Infrastruktur-, API- und supabase-Pfade fuer Slice 0/3 bewusst NICHT enthalten'). Grund: die Deployment-Entscheidung vom 21.08.2026 (Confluence 30998530) macht den Containerbau zur Voraussetzung des PENDING-Gates 'deploy' desselben Features. Ohne die Aufnahme kann der Slice, der dieses Gate vorbereitet, die Scope nicht einhalten.",
  "confirmed": false,
  "scope_ergaenzung": {
    "product": [
      "apps/api/Dockerfile",
      "apps/web/Dockerfile",
      ".dockerignore",
      "docker-compose.yml",
      "turbo.json",
      "apps/web/next.config.ts",
      "apps/api/test/architecture/deploy-authority-rules.ts",
      "apps/api/test/deploy-authority.test.ts"
    ],
    "governance": [".github/workflows/**", "scripts/**", "docs/runbooks/**"]
  }
}
```

Nach der Bestätigung ist die Bindung neu zu setzen: neuer `shasum -a 256` des Manifests in
`.plumbline/scope-authority/easytree-sprint-6-core-journey.json`.

### Weg 2 — EYT-126 als eigenes Plumbline-Feature armieren

Der Containerpfad bekommt ein eigenes `docs/scope/eyt-126-container-staging.scope.json` samt
eigener Bindung und eigenem Ledger, und `docs/context/.active-feature` wird pro Slice umgestellt.
Vorteil: sauber getrennte Verantwortungen, und es entspricht der Formulierung „Slice 0/3" aus
Revision 1. Nachteil: mehr Governance-Mechanik und ein zweiter Ledger für dasselbe Sprintziel.

**Empfehlung: Weg 1.** Der Containerbau existiert ausschliesslich, um das `deploy`-Gate desselben
Features passierbar zu machen; zwei Autoritäten für ein Gate sind eine Naht ohne Nutzen.

## Unabhängig davon: die veraltete Base

`docs/context/.scope-base` auf `f3b427d` stehen zu lassen, macht jeden künftigen Lauf des Gates
unlesbar — er meldet dauerhaft die 28 bereits gemergten Dateien mit. Das ist ein eigener,
kleinerer Beschluss und ausdrücklich **nicht** Teil dieses Slice: eine Base zu verschieben
verkleinert die geprüfte Oberfläche, und das entscheidet niemand nebenbei, schon gar nicht der
Slice, dessen Befund dadurch kleiner würde.
