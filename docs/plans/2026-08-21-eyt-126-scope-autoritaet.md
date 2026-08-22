# EYT-126 — der Containerpfad liegt ausserhalb der armierten Sprint-6-Scope

> **Status: `ENTSCHIEDEN` (21.08.2026).** Der PO hat Weg 1 gewählt; Revision 5 ist gesetzt und
> die Bindung neu gezogen. Der Abschnitt „Ausgang“ am Ende hält fest, was daraus wurde —
> einschließlich einer Abweichung vom Entwurf und einer zurückgenommenen Empfehlung.

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

## Ausgang — beides erledigt am 21.08.2026

**Weg 1 gewählt und ausgeführt.** Revision 5 steht im Manifest, `confirmed: true`, mit dem PO als
`decision_maker`. Die Bindung unter `.plumbline/scope-authority/` wurde neu gesetzt
(`8032224886184ed8…` → `d5b483614d8e81c7…`, geprüft gegen `shasum -a 256` des Manifests). Die
Digest-Konvention wurde vorher gegen **alle vier** bestehenden Revisionen verifiziert, nicht
erraten: `sha256(JSON.stringify(scope, Object.keys(scope).sort()))`, vier von vier stimmen.

Gegen Revision 5 sind **alle elf** Dateien dieses Slice in der Scope; der Gate meldet mit der
korrekten Base `PRIL scope check passed … (31 changed files)`, Exit 0.

**Abweichung vom Entwurf oben, laut benannt:** Revision 5 nimmt zusätzlich `docs/architecture/**`
auf. Grund ist Konsistenz — sieben andere `docs/**`-Pfade stehen bereits in der Governance-Scope,
und `docs/architecture/` trägt ADR-001/002/003. Die Folge, die man kennen muss: damit fällt auch
die vorbestehende, **ungetrackte** Datei `docs/architecture/EasyTree – Softwaredokumentation.md`
in die Scope. Sie stammt nicht aus diesem Slice und wurde in diesem Lauf von niemandem geprüft.
`supabase/**` bleibt weiterhin ausgeschlossen.

### Die veraltete Base — die Begründung hat sich umgedreht

Der ursprüngliche Absatz hier lautete, das Verschieben der Base sei „ausdrücklich **nicht** Teil
dieses Slice", weil es die geprüfte Oberfläche verkleinert und der Slice davon profitierte. Dieser
Einwand ist mit Revision 5 **gegenstandslos geworden und wird hiermit zurückgenommen**: gemessen
ist der Befund dieses Slice gegen beide Basen **null**. Verschieben ändert an seiner
Rechenschaft nichts, es entfernt nur die 21 bereits auf `master` gemergten, bereits reviewten
Dateien aus der Meldung.

`docs/context/.scope-base` steht deshalb jetzt auf `origin/master` (`4e257f95…`) statt auf
`f3b427d`. Das ist dieselbe Konvention wie vorher — eine Commit-SHA — und entspricht dem, was eine
Merge-Base nach einem abgeschlossenen `merge`-Gate ist. Das `merge`-Gate dieses Features ist am
20.08.2026 `CLEARED`; `deploy` und `production-verification` bleiben `PENDING`, das Feature bleibt
also zu Recht armiert.

**Nicht gemergt und nicht versioniert:** `.plumbline/` steht in `.gitignore`. Die neue Bindung
existiert damit nur lokal. Wer den Gate auf einer anderen Maschine fährt, bringt seine eigene
Bindung mit und muss sie einmalig gegen den Manifest-Hash `d5b483614d8e81c7…` setzen.

## Nachtrag — Revision 6 am 22.08.2026

Der Reparatur-Slice zu PR #89 (Laufzeit-Proxyziel, Plan
`docs/plans/2026-08-21-eyt-126-laufzeit-proxyziel.md`) brauchte sechs Pfade, die
Revision 5 nicht deckte. Der PO hat sie am 22.08.2026 bestätigt („Revision 6
bestätigt"), ausdrücklich ohne weitere Erweiterung.

```
apps/web/app/api/**
apps/web/app/health/**
apps/web/app/ready/**
apps/web/instrumentation.ts
apps/api/test/architecture/secret-surface-rules.ts
apps/api/test/container-bindung.test.ts
```

Der Grund liegt in einer Messung, nicht in einer Vorliebe: der Same-Origin-Proxy
muss aus `next.config.ts`-`rewrites()` heraus, weil Next das Ergebnis beim Bauen
nach `routes-manifest.json` schreibt und ein fertiges Image damit an sein Ziel
gebunden wäre. Der naheliegende Ersatz — eine Next-16-`proxy.ts` — ist zweifach
gemessen ausgeschieden: `NextResponse.rewrite()` auf ein externes Ziel sendet
`x-middleware-rewrite` mit der internen Adresse an den Browser und lässt sich
nicht entfernen, ohne die Weiterleitung abzuschalten; und
`@opennextjs/cloudflare` bricht mit „Node.js middleware is not currently
supported" ab, was den Pflichtjob `build-web` rot machen würde. Übrig bleiben
Route Handler — und die liegen unter `apps/web/app/`, wo Revision 5 nur
`planung/**` und `globals.css` führte.

**Nichts weiter war nötig.** `apps/web/lib/**` und `apps/web/test/**` stehen seit
Revision 1 als Platzhalter in der Scope, die Container- und CI-Pfade kamen mit
Revision 5.

Bindung neu gezogen: `d5b483614d8e81c7…` → `2741c0ec0935d01d…`, geprüft gegen
`shasum -a 256` des Manifests. Die Digest-Konvention wurde vorher erneut gegen
**alle fünf** bestehenden Revisionen verifiziert (5/5), nicht aus diesem
Dokument übernommen. Revisionen 1–5 sind unverändert, kein Pfad ging verloren.
Der Gate meldet mit Base `origin/master`: `PRIL scope check passed … (33 changed
files)`, Exit 0.

**Zwei Grenzen, in diesem Lauf gemessen und vorher nirgends notiert:**

1. `.plumbline/` ist per `.gitignore:35` ausgeschlossen, der Feature-Marker
   `docs/context/.active-feature` dagegen versioniert.
2. Fehlt die Bindung — etwa in einem frischen Worktree — meldet der Gate
   trotzdem `passed` und **nicht** `SCOPE_AUTHORITY_CHANGED`. Gemessen durch
   Wegbewegen von `.plumbline/` und erneuten Lauf. Die Manipulationsbindung ist
   dort also nicht scharf; wer in einem neuen Worktree arbeitet, kopiert
   `.plumbline/` mit.
