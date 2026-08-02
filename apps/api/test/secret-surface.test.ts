/**
 * Privilegierte Zugaenge erreichen weder Browser noch Anfragepfad
 * (EYT-106 AK6, EYT-133).
 *
 * Fuehrt die Regeln aus `architecture/secret-surface-rules.ts` gegen den
 * ECHTEN Baum aus. Der rote Fall — jede Regel feuert nachweislich — steht in
 * `secret-surface.red-case.test.ts` gegen einen Wegwerfbaum unter
 * `os.tmpdir()`; im echten Baum liesse er sich nur durch eine Mutation
 * erzeugen, die anschliessend jemand vergisst zurueckzunehmen.
 *
 * Diese Datei nennt die verbotenen Bezeichner NICHT aus — sonst meldete der
 * Wächter sich selbst. Wo sie unvermeidlich sind, werden sie zusammengesetzt
 * (dieselbe Technik wie `apps/web/test/no-supabase-import.test.ts` Z. 12).
 *
 * Laeuft im Pflichtjob `unit-tests` (`pnpm test` → `turbo run test` →
 * `apps/api` `vitest run`, `include: test/**\/*.test.ts`). Bewusst KEIN neuer
 * CI-Job: der waere kein Pflichtcheck, bis jemand mit Repository-Adminrechten
 * das Ruleset neu anwendet, und beide Kopien der Pflichtcheck-Liste in
 * `scripts/setup-branch-protection.sh` und `scripts/verify-branch-protection.sh`
 * muessten mitgezogen werden.
 */
import { describe, expect, it } from "vitest";

import {
  collectFilesNamed,
  collectSourceFiles,
  extractImports,
  findRepoRoot,
} from "./architecture/scan";
import {
  ERLAUBTE_UMGEBUNGSLESER,
  NICHT_LAUFZEITFAEHIGE_PAKETE,
  PRIVILEGIERTE_ORTE,
  SECRET_RULES,
  entferneKommentare,
  evaluateSecretRules,
  istCodeDatei,
  istLaufzeitpfad,
  render,
  umgebungszugriffe,
} from "./architecture/secret-surface-rules";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";

const repoRoot = findRepoRoot(process.cwd());

/**
 * Zwei Sammler, weil `collectSourceFiles` nur die TypeScript-/JavaScript-
 * Endungen kennt (`SOURCE_EXTENSIONS`). SQL, TOML, YAML und Shell fallen
 * dort durch — und genau dort stehen die Migrations- und CI-Zugaenge, um die
 * es hier geht. Beim ersten Lauf war `supabase/` deshalb leer und die
 * Eingangsbremse hat es gemeldet.
 */
const dateien = [
  ...collectSourceFiles(repoRoot, "apps"),
  ...collectSourceFiles(repoRoot, "packages"),
  ...collectSourceFiles(repoRoot, "scripts"),
  ...collectFilesNamed(repoRoot, "scripts", /\.sh$/),
  ...collectFilesNamed(repoRoot, "supabase", /\.(sql|toml)$/),
  ...collectFilesNamed(repoRoot, ".github", /\.(yml|yaml)$/),
  // SQL liegt nicht nur unter `supabase/`: die E2E-Reise bringt ihre
  // Testdaten in `apps/web/e2e/auth-journey/` mit. Ein Migrationszugang
  // koennte sich genauso gut dorthin verirren.
  ...collectFilesNamed(repoRoot, "apps", /\.sql$/),
].filter(istCodeDatei);

const refs = extractImports(repoRoot, dateien);
const bericht = evaluateSecretRules({ repoRoot, files: dateien, refs });

describe("Geheimnisgrenze — der Wächter misst ueberhaupt etwas (EYT-106 AK6)", () => {
  it("hat Quelltext aus allen vier Bereichen gesehen", () => {
    // Ohne diese Bremse waere ein kaputter Glob ein gruener Lauf: keine
    // Datei, keine Verletzung, "bestanden".
    expect(dateien.length).toBeGreaterThan(80);
    expect(dateien.some((d) => d.startsWith("apps/api/src/"))).toBe(true);
    expect(dateien.some((d) => d.startsWith("apps/web/"))).toBe(true);
    expect(dateien.some((d) => d.startsWith("supabase/"))).toBe(true);
    expect(dateien.some((d) => d.startsWith(".github/"))).toBe(true);
  });

  it.each(SECRET_RULES.map((regel) => [regel.id, regel.summary] as const))(
    "Regel %s hat mindestens eine Datei betrachtet",
    (id, summary) => {
      expect(bericht.seen.get(id)?.size ?? 0, `${id}: ${summary}`).toBeGreaterThan(0);
    },
  );

  it("sieht die Auth-Kette unter platform/, wo api-dependency-allowlist aufhoert", () => {
    // Der namentliche Nachweis fuer die eigentliche Luecke: die bestehende
    // Architekturregel nimmt `apps/api/src/platform/**` ausdruecklich aus,
    // und dort liegt die gesamte Session- und Loginkette.
    const gesehen = bericht.seen.get("runtime-reads-no-environment") ?? new Set<string>();
    expect(gesehen.has("apps/api/src/platform/auth/token-verifier.ts")).toBe(true);
    expect(gesehen.has("apps/api/src/platform/auth/request-identity.ts")).toBe(true);
    expect(gesehen.has("apps/api/src/platform/auth/session-liveness.ts")).toBe(true);
    expect(gesehen.has("apps/api/src/platform/auth/supabase-token-verifier.factory.ts")).toBe(true);
  });

  it("sieht Controller, Application, Domain, Middleware und den Webcode", () => {
    const gesehen = bericht.seen.get("runtime-reads-no-environment") ?? new Set<string>();
    for (const pflicht of [
      "apps/api/src/modules/costs/interface/http/costs.controller.ts",
      "apps/api/src/modules/tenancy/interface/http/auth.controller.ts",
      "apps/api/src/modules/costs/application/cost-access.policy.ts",
      "apps/api/src/modules/costs/domain/rate-effectivity.ts",
      "apps/api/src/common/correlation-id.middleware.ts",
      "apps/web/app/providers.tsx",
    ]) {
      expect(gesehen.has(pflicht), `nicht betrachtet: ${pflicht}`).toBe(true);
    }
  });
});

describe("Geheimnisgrenze — der echte Baum ist sauber (EYT-106 AK6)", () => {
  it("meldet keine Verletzung", () => {
    console.log(
      `[secret-surface] dateien=${dateien.length} imports=${refs.length} ` +
        `regeln=${SECRET_RULES.length} ausnahmen=${PRIVILEGIERTE_ORTE.length} ` +
        `umgebungsleser=${ERLAUBTE_UMGEBUNGSLESER.length} findings=${bericht.findings.length}`,
    );
    expect(render(bericht.findings)).toEqual([]);
  });
});

describe("Die Ausnahmelisten sind eng und lebendig (EYT-106 AK6)", () => {
  it.each(PRIVILEGIERTE_ORTE.map((ort) => [ort.datei, ort.grund] as const))(
    "%s existiert und ist begruendet",
    (datei, grund) => {
      expect(existsSync(`${repoRoot}/${datei}`), `Ausnahme zeigt ins Leere: ${datei}`).toBe(true);
      // Eine Begruendung, die nichts erklaert, ist keine. 40 Zeichen sind
      // kein Qualitaetsmass, aber sie schliessen "TODO" und "ok" aus.
      expect(grund.length).toBeGreaterThan(40);
    },
  );

  it("jede Paketausnahme existiert und ist wirklich nicht laufzeitfaehig", () => {
    // Der teuerste Eintrag in dieser Liste ist der tote: er steht wie eine
    // bewusste Entscheidung da, nimmt aber nichts (mehr) aus — und deckt beim
    // naechsten Umbau versehentlich etwas Neues.
    //
    // Zwei Bedingungen je Eintrag, beide gemessen statt geglaubt:
    //   1. das Paket existiert ueberhaupt;
    //   2. es ist KEINE produktive Abhaengigkeit von apps/api oder apps/web —
    //      sonst waere die Behauptung "nicht laufzeitfaehig" schlicht falsch.
    const produktiveAbhaengigkeiten = new Set<string>();
    for (const app of ["apps/api", "apps/web"]) {
      const manifest = JSON.parse(readFileSync(`${repoRoot}/${app}/package.json`, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      for (const name of Object.keys(manifest.dependencies ?? {})) {
        if (name.startsWith("@easytree/")) produktiveAbhaengigkeiten.add(name);
      }
    }

    for (const { paket, grund } of NICHT_LAUFZEITFAEHIGE_PAKETE) {
      const pfad = `${repoRoot}/packages/${paket}/package.json`;
      expect(existsSync(pfad), `Ausnahme nennt ein Paket, das es nicht gibt: ${paket}`).toBe(true);
      const name = (JSON.parse(readFileSync(pfad, "utf8")) as { name: string }).name;
      expect(
        produktiveAbhaengigkeiten.has(name),
        `${name} ist produktive Abhaengigkeit von apps/api oder apps/web — ` +
          `die Ausnahme "nicht laufzeitfaehig" ist damit falsch.`,
      ).toBe(false);
      expect(grund.length).toBeGreaterThan(40);
    }

    // Heute leer, und das ist der gemessene Normalfall: alle vier Pakete sind
    // produktive Abhaengigkeit. Die Zeile haelt fest, dass die Leere gewollt
    // ist und nicht daher kommt, dass jemand die Liste vergessen hat.
    expect(NICHT_LAUFZEITFAEHIGE_PAKETE.length).toBe(0);
  });

  it("keine Ausnahme ist ein Verzeichnismuster", () => {
    // PO-Vorgabe 01.08.2026: "Keine breite Allowlist nach Verzeichnisnamen."
    for (const { datei } of PRIVILEGIERTE_ORTE) {
      expect(datei).not.toContain("*");
      expect(datei.endsWith("/"), `${datei} ist ein Verzeichnis`).toBe(false);
      expect(istCodeDatei(datei), `${datei} ist keine gepruefte Codedatei`).toBe(true);
    }
  });

  it("jede Ausnahme nimmt heute wirklich etwas aus", () => {
    // Der teuerste Fehler an einer Ausnahmeliste ist der tote Eintrag: er
    // steht wie eine bewusste Entscheidung da, deckt aber nichts mehr ab und
    // deckt beim naechsten Mal versehentlich etwas Neues.
    const ohneAusnahmen = evaluateSecretRules({
      repoRoot,
      files: dateien,
      refs,
    });
    expect(ohneAusnahmen.findings).toEqual([]);

    for (const { datei } of PRIVILEGIERTE_ORTE) {
      const roh = entferneKommentare(readFileSync(`${repoRoot}/${datei}`, "utf8"), datei);
      const trifft = [
        ["SERVICE", "ROLE"].join("_"),
        ["SECRET", "KEY"].join("_"),
        ["JWT", "SECRET"].join("_"),
        ["service", "role"].join("_"),
        ["PG", "PASSWORD"].join(""),
        ["DB", "PASSWORD"].join("_"),
        ["SUPABASE", "ACCESS", "TOKEN"].join("_"),
      ].some((name) => roh.toUpperCase().includes(name.toUpperCase()));
      expect(trifft, `Ausnahme ${datei} nimmt nichts mehr aus — Eintrag entfernen`).toBe(true);
    }
  });

  it.each(ERLAUBTE_UMGEBUNGSLESER.map((e) => [e.datei, e.grund] as const))(
    "Umgebungsleser %s existiert, liest wirklich und ist begruendet",
    (datei, grund) => {
      const pfad = `${repoRoot}/${datei}`;
      expect(existsSync(pfad), `Ausnahme zeigt ins Leere: ${datei}`).toBe(true);
      expect(grund.length).toBeGreaterThan(40);
      expect(istLaufzeitpfad(datei), `${datei} liegt gar nicht im Laufzeitpfad`).toBe(true);
      const zugriffe = umgebungszugriffe(readFileSync(pfad, "utf8"), datei);
      const echte = zugriffe.filter((z) => z.schluessel !== "NODE_ENV");
      expect(
        echte.length,
        `Ausnahme ${datei} liest keine Umgebungsvariable mehr — Eintrag entfernen`,
      ).toBeGreaterThan(0);
    },
  );
});
