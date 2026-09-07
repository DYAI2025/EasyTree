/**
 * Nachweis fuer den DRS-Shadow-Contract-Validator (EYT-162, Slice 1).
 *
 * WARUM node:test UND NICHT VITEST
 * --------------------------------
 * Die Vitest-Suiten dieses Repositories liegen ausnahmslos in `apps/*` und
 * `packages/*`. Beide Flaechen sind fuer EYT-162 Slice 1 ausdruecklich
 * gesperrt. `node --test` ist in Node 22 eingebaut, braucht also keine neue
 * Abhaengigkeit und keinen neuen Laufzeitstack — die einzige Variante, die
 * Testnachweis liefert, ohne den Scope zu verlassen.
 *
 * PRUEFMETHODE: MUTATION DES ECHTEN VERTRAGS
 * ------------------------------------------
 * Jeder Negativfall entsteht aus dem eingecheckten `.drs/contracts/
 * EYT-162.contract.json`, nicht aus einer eigenen Kopie. Damit belegt derselbe
 * Lauf zwei Dinge: der ausgelieferte Vertrag ist gruen, UND genau ein
 * benannter Defekt macht ihn rot. Eine Fixture-Kopie koennte still vom echten
 * Vertrag abdriften und beides gleichzeitig behaupten.
 *
 * NICHT-LEERLAUF
 * --------------
 * `Regelabdeckung` unten vergleicht die Menge der hier tatsaechlich
 * geprueften Regel-IDs mit der Registry in `contract-invariants.mjs`. Eine
 * neue Invariante ohne Test macht die Suite rot; ein Test auf eine
 * geloeschte Regel ebenso. Ohne diesen Vergleich koennte eine Invariante
 * ungeprueft mitlaufen und Sicherheit vortaeuschen.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { INVARIANT_IDS } from "../contract-invariants.mjs";
import { CONTRACT_PFAD, VALIDATOR_PFAD, validiereVertrag } from "../validate-contract.mjs";

const repoWurzel = fileURLToPath(new URL("../../../", import.meta.url));
const echterVertragPfad = join(repoWurzel, CONTRACT_PFAD);

/** Frische, tiefe Kopie des eingecheckten Vertrags — Mutationen bleiben lokal. */
function vertrag() {
  return JSON.parse(readFileSync(echterVertragPfad, "utf8"));
}

/**
 * Fuehrt eine Mutation aus und verlangt, dass GENAU die benannte Regel
 * anschlaegt. Die Regel-ID wird zurueckgegeben, damit `Regelabdeckung`
 * mitzaehlen kann, welche Invarianten dieser Lauf wirklich beruehrt hat.
 */
const geprueft = new Set();
function erwarteBefund(mutieren, regel) {
  const eingabe = vertrag();
  mutieren(eingabe);
  const ergebnis = validiereVertrag(eingabe, { repoWurzel });
  const ids = ergebnis.befunde.map((b) => b.regel);
  assert.equal(ergebnis.ok, false, `Mutation blieb gruen; Regel ${regel} hat nicht ausgeloest`);
  assert.ok(
    ids.includes(regel),
    `Regel ${regel} fehlt in den Befunden. Gemeldet wurde: ${ids.join(", ") || "(nichts)"}`,
  );
  geprueft.add(regel);
}

/* ------------------------------------------------------------- POSITIV ---- */

test("der eingecheckte EYT-162-Vertrag ist strukturell und invariant gueltig", () => {
  const ergebnis = validiereVertrag(vertrag(), { repoWurzel });
  assert.deepEqual(
    ergebnis.befunde.map((b) => `${b.regel} @ ${b.pfad}: ${b.meldung}`),
    [],
  );
  assert.equal(ergebnis.ok, true);
});

test("der eingecheckte Vertrag ist ausdruecklich SHADOW, nicht autoritativ und nicht angenommen", () => {
  const v = vertrag();
  assert.equal(v.enforcement_mode, "SHADOW");
  assert.equal(v.acceptance_state, "NOT_ACCEPTED");
  assert.equal(v.authority_model.non_authoritative, true);
  assert.equal(v.authority_model.confers_merge_authority, false);
  assert.equal(v.acceptance_authority.resolution, "UNRESOLVED");
});

/* ------------------------------------------------ STRUKTUR (fail closed) --- */

test("NEGATIV 1: fehlender jira_key faellt", () => {
  const eingabe = vertrag();
  delete eingabe.jira_key;
  const ergebnis = validiereVertrag(eingabe, { repoWurzel });
  assert.equal(ergebnis.ok, false);
  assert.ok(ergebnis.befunde.some((b) => b.regel === "field-required" && b.pfad === "jira_key"));
});

test("NEGATIV 2: unsyntaktischer base_sha faellt", () => {
  const eingabe = vertrag();
  eingabe.base_sha = "f8e96e4";
  const ergebnis = validiereVertrag(eingabe, { repoWurzel });
  assert.equal(ergebnis.ok, false);
  assert.ok(ergebnis.befunde.some((b) => b.regel === "git-sha-syntax" && b.pfad === "base_sha"));
});

test("NEGATIV 7a: unsyntaktischer allowed_paths-Eintrag faellt", () => {
  const eingabe = vertrag();
  eingabe.allowed_paths = [...eingabe.allowed_paths, "../ausserhalb/**"];
  const ergebnis = validiereVertrag(eingabe, { repoWurzel });
  assert.equal(ergebnis.ok, false);
  assert.ok(ergebnis.befunde.some((b) => b.regel === "path-pattern-syntax"));
});

test("NEGATIV 7b: unsyntaktischer forbidden_paths-Eintrag faellt", () => {
  const eingabe = vertrag();
  eingabe.forbidden_paths = [...eingabe.forbidden_paths, "/etc/passwd"];
  const ergebnis = validiereVertrag(eingabe, { repoWurzel });
  assert.equal(ergebnis.ok, false);
  assert.ok(
    ergebnis.befunde.some(
      (b) => b.regel === "path-pattern-syntax" && b.pfad.startsWith("forbidden_paths"),
    ),
  );
});

test("ein unbekanntes Feld faellt — der Vertrag ist strikt, nicht offen", () => {
  const eingabe = vertrag();
  eingabe.merge_authority = true;
  const ergebnis = validiereVertrag(eingabe, { repoWurzel });
  assert.equal(ergebnis.ok, false);
  assert.ok(ergebnis.befunde.some((b) => b.regel === "unknown-field"));
});

test("ein source_binding kann keine freie Produktwahrheit tragen", () => {
  const eingabe = vertrag();
  eingabe.source_bindings[0].content = "Die Akzeptanzkriterien lauten ...";
  const ergebnis = validiereVertrag(eingabe, { repoWurzel });
  assert.equal(ergebnis.ok, false);
  assert.ok(ergebnis.befunde.some((b) => b.regel === "unknown-field"));
});

/* -------------------------------------------------------- INVARIANTEN ----- */

test("NEGATIV 3: R2G PASS ohne candidate_sha faellt", () => {
  erwarteBefund((v) => {
    v.candidate_sha = null;
    v.gates.r2g.state = "PASS";
    v.gates.r2g.evaluated_against_sha = null;
  }, "r2g-pass-requires-candidate-sha");
});

test("NEGATIV 4: R4M PASS bei nicht bestandenem R2G faellt", () => {
  erwarteBefund((v) => {
    v.candidate_sha = "1111111111111111111111111111111111111111";
    v.gates.r2g.state = "FAIL";
    v.gates.r2g.evaluated_against_sha = "1111111111111111111111111111111111111111";
    v.gates.r4m.state = "PASS";
    v.gates.r4m.evaluated_against_sha = "1111111111111111111111111111111111111111";
  }, "r4m-pass-requires-r2g-pass");
});

test("NEGATIV 5: enforcement_mode REQUIRED faellt in Slice 1", () => {
  erwarteBefund((v) => {
    v.enforcement_mode = "REQUIRED";
  }, "slice-1-shadow-only");
});

test("NEGATIV 6a: ein vom Implementierer selbst behaupteter PASS faellt", () => {
  erwarteBefund((v) => {
    v.acceptance_authority.asserted_by_implementer = true;
  }, "acceptance-authority-not-implementer");
});

test("NEGATIV 6b: acceptance_authority gleich dem Implementierer faellt", () => {
  erwarteBefund((v) => {
    v.acceptance_authority.resolution = "RESOLVED";
    v.acceptance_authority.acceptor_ref = v.implementation_agent.ref;
  }, "acceptance-authority-not-implementer");
});

test("ein veralteter Kandidaten-SHA an einem PASS-Gate faellt", () => {
  erwarteBefund((v) => {
    v.candidate_sha = "1111111111111111111111111111111111111111";
    v.state = "IC";
    v.gates.ic.state = "PASS";
    v.gates.ic.evaluated_against_sha = "2222222222222222222222222222222222222222";
  }, "gate-pass-requires-current-candidate-sha");
});

test("R4M PASS gegen einen anderen SHA als R2G faellt", () => {
  erwarteBefund((v) => {
    v.candidate_sha = "1111111111111111111111111111111111111111";
    v.state = "R4M";
    v.gates.r2g.state = "PASS";
    v.gates.r2g.evaluated_against_sha = "2222222222222222222222222222222222222222";
    v.gates.r4m.state = "PASS";
    v.gates.r4m.evaluated_against_sha = "1111111111111111111111111111111111111111";
  }, "r4m-pass-requires-same-candidate-sha");
});

test("ein INVALIDATED-Gate ohne Invalidierungsmetadaten faellt", () => {
  erwarteBefund((v) => {
    v.gates.r2g.state = "INVALIDATED";
  }, "invalidation-requires-metadata");
});

test("ein invalidierter Vertrag darf kein PASS tragen", () => {
  erwarteBefund((v) => {
    v.candidate_sha = "1111111111111111111111111111111111111111";
    v.state = "IC";
    v.gates.ic.state = "PASS";
    v.gates.ic.evaluated_against_sha = "1111111111111111111111111111111111111111";
    v.invalidation = {
      invalidated: true,
      reason: "Nachtraeglicher Commit auf dem Kandidaten",
      at: "2026-09-07T12:00:00+02:00",
      superseded_candidate_sha: "2222222222222222222222222222222222222222",
    };
  }, "invalidated-contract-has-no-pass");
});

test("ein Zustand ohne das zugehoerige bestandene Gate faellt", () => {
  erwarteBefund((v) => {
    v.state = "R2G";
  }, "state-requires-gate-pass");
});

test("ein Vertrag, der sich Merge-Autoritaet zuschreibt, faellt", () => {
  erwarteBefund((v) => {
    v.authority_model.confers_merge_authority = true;
  }, "authority-model-is-derived-projection");
});

test("acceptance_state ACCEPTED ohne aufgeloeste Autoritaet faellt", () => {
  erwarteBefund((v) => {
    v.acceptance_state = "ACCEPTED";
  }, "acceptance-state-requires-resolved-authority");
});

test("eine aufgeloeste Autoritaet ohne Acceptor-Referenz faellt", () => {
  erwarteBefund((v) => {
    v.acceptance_authority.resolution = "RESOLVED";
  }, "acceptance-authority-resolution-consistency");
});

test("Slice 1 laesst keine bereits aufgeloeste Acceptor-Autoritaet zu", () => {
  erwarteBefund((v) => {
    v.acceptance_authority.resolution = "RESOLVED";
    v.acceptance_authority.acceptor_ref = "unabhaengiger-acceptor";
  }, "slice-1-acceptance-authority-unresolved");
});

test("Slice 1 laesst keinen angenommenen Vertrag zu", () => {
  erwarteBefund((v) => {
    v.acceptance_state = "ACCEPTED";
    v.acceptance_authority.resolution = "RESOLVED";
    v.acceptance_authority.acceptor_ref = "unabhaengiger-acceptor";
  }, "slice-1-acceptance-not-accepted");
});

test("derselbe Pfad in allowed_paths und forbidden_paths faellt", () => {
  erwarteBefund((v) => {
    v.forbidden_paths = [...v.forbidden_paths, v.allowed_paths[0]];
  }, "paths-disjoint");
});

test("ohne Jira-Bindung auf den eigenen jira_key faellt der Vertrag", () => {
  erwarteBefund((v) => {
    v.source_bindings = v.source_bindings.filter(
      (b) => !(b.authority === "JIRA" && b.binding_kind === "ACCEPTANCE_CRITERIA"),
    );
  }, "source-bindings-name-upstream-authority");
});

test("ein Vertrag, der seine Slice-1-Grenzen verschweigt, faellt", () => {
  erwarteBefund((v) => {
    v.known_boundaries = v.known_boundaries.filter((b) => b !== "NO_CI_ENFORCEMENT");
  }, "slice-1-declares-known-boundaries");
});

/* ------------------------------------------------------ CLI fail-closed --- */

function cli(...argumente) {
  return spawnSync(process.execPath, [join(repoWurzel, VALIDATOR_PFAD), ...argumente], {
    encoding: "utf8",
  });
}

test("CLI: der eingecheckte Vertrag ergibt Exit 0 und meldet sich als SHADOW", () => {
  const lauf = cli(echterVertragPfad);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /\[drs-contract\] mode=shadow authoritative=no /);
  assert.match(lauf.stdout, /findings=0/);
});

test("CLI: ein verletzter Vertrag ergibt Exit 1", () => {
  const verzeichnis = mkdtempSync(join(tmpdir(), "drs-contract-"));
  const pfad = join(verzeichnis, "kaputt.contract.json");
  const eingabe = vertrag();
  eingabe.enforcement_mode = "REQUIRED";
  writeFileSync(pfad, JSON.stringify(eingabe, null, 2));
  const lauf = cli(pfad);
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout + lauf.stderr, /slice-1-shadow-only/);
});

test("CLI: kein JSON ergibt Exit 2 statt einer stillen Null", () => {
  const lauf = cli(join(repoWurzel, "scripts/drs/test/fixtures/kein-json.contract.txt"));
  assert.equal(lauf.status, 2, lauf.stdout + lauf.stderr);
});

test("CLI: eine fehlende Datei ergibt Exit 2", () => {
  const lauf = cli(join(repoWurzel, "scripts/drs/test/fixtures/gibt-es-nicht.json"));
  assert.equal(lauf.status, 2, lauf.stdout + lauf.stderr);
});

test("CLI: ohne Argument wird nichts stillschweigend als gruen gemeldet", () => {
  const lauf = cli();
  assert.notEqual(lauf.status, 0);
});

/* ------------------------------------------------------ Regelabdeckung ---- */

test("jede registrierte Invariante wird von genau dieser Suite rot gemacht", () => {
  const registriert = [...INVARIANT_IDS].sort();
  const abgedeckt = [...geprueft].sort();
  assert.deepEqual(
    abgedeckt,
    registriert,
    "Registry und Testabdeckung weichen ab. Fehlend: " +
      registriert.filter((id) => !geprueft.has(id)).join(", ") +
      " | ueberzaehlig: " +
      abgedeckt.filter((id) => !INVARIANT_IDS.includes(id)).join(", "),
  );
});
