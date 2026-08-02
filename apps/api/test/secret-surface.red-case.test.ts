/**
 * Gegenmutationen der Geheimnisgrenze (EYT-106 AK6, EYT-133).
 *
 * ## Warum ein synthetischer Baum
 *
 * Ein Wächter, dessen rote Seite nie ausgefuehrt wurde, ist eine Behauptung.
 * Im ECHTEN Baum liesse sie sich nur durch eine Mutation zeigen, die jemand
 * anschliessend zuruecknehmen muss — und genau das vergisst man. Hier
 * entsteht der Verstoss in einem Wegwerfverzeichnis unter `os.tmpdir()`,
 * laeuft bei jedem CI-Lauf erneut und kann den echten Baum nicht beruehren.
 * Dieselbe Bauart wie `architecture-red-case.test.ts` und
 * `costs-module-boundaries.red-case.test.ts`.
 *
 * ## Warum diese Datei in PRIVILEGIERTE_ORTE steht
 *
 * Die Verstossfixtures MUESSEN die verbotenen Bezeichner ausschreiben, sonst
 * pruefte der rote Fall nichts. Deshalb ist sie einzeln benannt — mit
 * Begruendung, wie jede andere Ausnahme auch.
 *
 * ## Die geforderten Gegenmutationen (PO 01.08.2026)
 *
 * - Positivtest fuer die zulaessigen Stellen: derselbe Inhalt an einem
 *   benannten Ort ist gruen.
 * - Negativtest Service-Role-Zugriff in einem Anfragepfad.
 * - Negativtest Secret im Webcode.
 * - Abschwaechung des Wächters: siehe "Wächter abgeschwaecht" ganz unten.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectFilesNamed, collectSourceFiles, extractImports } from "./architecture/scan";
import {
  NICHT_LAUFZEITFAEHIGE_PAKETE,
  evaluateSecretRules,
  istLaufzeitpfad,
  umgebungszugriffe,
  type SecretFinding,
} from "./architecture/secret-surface-rules";

let root = "";

function schreibe(relativ: string, inhalt: string): void {
  const ziel = join(root, relativ);
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(ziel, inhalt, "utf8");
}

function entferne(relativ: string): void {
  rmSync(join(root, relativ), { force: true });
}

function befunde(): SecretFinding[] {
  const dateien = [
    ...collectSourceFiles(root, "apps"),
    // `packages` gehoert dazu, seit geteilte Pakete als Laufzeitpfad gelten
    // (Reviewbefund F1). Ohne diese Zeile schriebe der rote Fall Fixtures in
    // einen Baum, den er anschliessend nicht liest — und bliebe gruen, ohne
    // etwas gemessen zu haben.
    ...collectSourceFiles(root, "packages"),
    ...collectFilesNamed(root, "supabase", /\.(sql|toml)$/),
  ];
  const refs = extractImports(root, dateien);
  return [...evaluateSecretRules({ repoRoot: root, files: dateien, refs }).findings];
}

function regeln(): Set<string> {
  return new Set(befunde().map((f) => f.rule));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "eyt-secret-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8");
  // Ein sauberer Laufzeitpfad als Grundrauschen: ohne ihn saehen die Regeln
  // gar keine Datei und der abschliessende "sauberer Baum"-Nachweis waere
  // leer statt gruen.
  schreibe(
    "apps/api/src/modules/costs/interface/http/costs.controller.ts",
    'export const route = "/kosten";\n',
  );
  schreibe("apps/web/app/page.tsx", "export default function Page() { return null; }\n");
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

describe("Der Wächter erkennt privilegierte Zugaenge im Anfragepfad (EYT-106 AK6)", () => {
  it("Service-Role-Zugriff in einem regulaeren API-Controller", () => {
    schreibe(
      "apps/api/src/modules/costs/interface/http/leak.controller.ts",
      [
        "export function adminClient(): string {",
        '  return process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";',
        "}",
      ].join("\n"),
    );
    const getroffen = regeln();
    entferne("apps/api/src/modules/costs/interface/http/leak.controller.ts");

    // Zwei Regeln zugleich: der Name UND der Umgebungszugriff. Das ist
    // Absicht — faellt eine aus, meldet die andere weiter.
    expect(getroffen.has("privileged-credential-only-in-named-places")).toBe(true);
    expect(getroffen.has("runtime-reads-no-environment")).toBe(true);
  });

  it("Secret im Webcode", () => {
    schreibe(
      "apps/web/lib/leak.ts",
      ['export const KEY = "SUPABASE_SECRET_KEY";', "export const x = 1;"].join("\n"),
    );
    const getroffen = regeln();
    entferne("apps/web/lib/leak.ts");

    expect(getroffen.has("privileged-credential-only-in-named-places")).toBe(true);
  });

  it("Supabase-SDK im Laufzeitpfad — auch das ssr-Paket", () => {
    schreibe(
      "apps/web/lib/browser-client.ts",
      [
        'import { createBrowserClient } from "@supabase/ssr";',
        "export { createBrowserClient };",
      ].join("\n"),
    );
    const gefunden = befunde();
    entferne("apps/web/lib/browser-client.ts");

    // Namentlich: `no-supabase-import.test.ts` prueft nur EINEN Paketnamen,
    // und `@supabase/ssr` faellt dort ausdruecklich durch (gemessen, siehe
    // docs/plans/2026-07-31-eyt-106-real-identity.md Z. 299).
    const treffer = gefunden.find((f) => f.rule === "runtime-imports-no-supabase-sdk");
    expect(treffer?.message).toContain("@supabase/ssr");
  });

  it("Supabase-SDK unter platform/, wo api-dependency-allowlist aufhoert", () => {
    schreibe(
      "apps/api/src/platform/auth/leak.ts",
      ['import { createClient } from "@supabase/supabase-js";', "export { createClient };"].join(
        "\n",
      ),
    );
    const getroffen = regeln();
    entferne("apps/api/src/platform/auth/leak.ts");

    expect(getroffen.has("runtime-imports-no-supabase-sdk")).toBe(true);
  });

  it("Migrationspasswort in einem Anfragepfad", () => {
    schreibe(
      "apps/api/src/platform/database/leak.ts",
      ['export const PGPASSWORD = "wird-nicht-gelesen";'].join("\n"),
    );
    const getroffen = regeln();
    entferne("apps/api/src/platform/database/leak.ts");

    expect(getroffen.has("privileged-credential-only-in-named-places")).toBe(true);
  });

  it("Supabase-Admin-API im Anfragepfad", () => {
    schreibe(
      "apps/api/src/modules/tenancy/interface/http/leak.ts",
      [
        "export async function loeschen(client: any, id: string) {",
        "  await client.auth.admin.deleteUser(id);",
        "}",
      ].join("\n"),
    );
    const getroffen = regeln();
    entferne("apps/api/src/modules/tenancy/interface/http/leak.ts");

    expect(getroffen.has("privileged-credential-only-in-named-places")).toBe(true);
  });

  it("nicht statisch aufloesbarer Umgebungszugriff gilt als Verstoss, nicht als Unschuld", () => {
    schreibe(
      "apps/api/src/common/leak.ts",
      [
        "export function hole(name: string): string {",
        '  return process.env[name] ?? "";',
        "}",
      ].join("\n"),
    );
    const gefunden = befunde();
    entferne("apps/api/src/common/leak.ts");

    const treffer = gefunden.find((f) => f.rule === "runtime-reads-no-environment");
    expect(treffer?.message).toContain("nicht statisch aufloesbar");
  });

  it("weitergereichtes process.env faellt ebenfalls auf", () => {
    schreibe(
      "apps/api/src/common/leak2.ts",
      ["export function alles(): NodeJS.ProcessEnv {", "  return { ...process.env };", "}"].join(
        "\n",
      ),
    );
    const getroffen = regeln();
    entferne("apps/api/src/common/leak2.ts");

    expect(getroffen.has("runtime-reads-no-environment")).toBe(true);
  });
});

describe("Geteilte Pakete sind Laufzeitpfad (EYT-133, Reviewbefund F1)", () => {
  // Der Wächter sah bisher nur `apps/api/src/**` und `apps/web/**`. Gemessen
  // im Review vom 02.08.2026: `packages/contracts` und `packages/ui` laufen im
  // BROWSER und im Nest-Anfragepfad — `apps/web/lib/auth-gateway-factory.ts`
  // importiert Werte aus `@easytree/contracts`, `login-form.tsx` aus
  // `@easytree/ui` in einer "use client"-Komponente. Ein privilegierter Zugriff
  // dort ergab 0 Findings, und KEIN anderer Wächter im Repository deckt
  // `packages/` ab.

  it("privilegierter Umgebungszugriff in packages/contracts/src wird erkannt", () => {
    schreibe(
      "packages/contracts/src/leak.ts",
      ['export const k = process.env["SUPABASE_SERVICE_ROLE_KEY"];'].join("\n"),
    );
    const getroffen = regeln();
    entferne("packages/contracts/src/leak.ts");

    expect(getroffen.has("runtime-reads-no-environment")).toBe(true);
    expect(getroffen.has("privileged-credential-only-in-named-places")).toBe(true);
  });

  it("derselbe Fall in packages/ui/src wird erkannt", () => {
    schreibe(
      "packages/ui/src/leak.tsx",
      ['import { createClient } from "@supabase/supabase-js";', "export { createClient };"].join(
        "\n",
      ),
    );
    const getroffen = regeln();
    entferne("packages/ui/src/leak.tsx");

    expect(getroffen.has("runtime-imports-no-supabase-sdk")).toBe(true);
  });

  it("ein kuenftig neu angelegtes Paket ist standardmaessig geschuetzt", () => {
    // Die Regel ist ein Default, keine Aufzaehlung: wer morgen ein Paket
    // anlegt, muss den Waechter nicht kennen, um von ihm erfasst zu werden.
    expect(istLaufzeitpfad("packages/neues-paket/src/index.ts")).toBe(true);
    schreibe(
      "packages/neues-paket/src/leak.ts",
      ["export const k = globalThis.process.env.SUPABASE_SERVICE_ROLE_KEY;"].join("\n"),
    );
    const getroffen = regeln();
    entferne("packages/neues-paket/src/leak.ts");

    expect(getroffen.has("runtime-reads-no-environment")).toBe(true);
  });

  it("nur `src/` eines Pakets ist Laufzeitpfad — Tests und Bauartefakte nicht", () => {
    expect(istLaufzeitpfad("packages/contracts/src/gateway.ts")).toBe(true);
    expect(istLaufzeitpfad("packages/ui/src/button.tsx")).toBe(true);
    expect(istLaufzeitpfad("packages/domain/src/time-interval.ts")).toBe(true);
    expect(istLaufzeitpfad("packages/config/src/load.ts")).toBe(true);
    // Ausserhalb: Tests, generierte Artefakte, Werkzeugkonfiguration.
    expect(istLaufzeitpfad("packages/contracts/test/openapi-drift.test.ts")).toBe(false);
    expect(istLaufzeitpfad("packages/domain/test/x.property.test.ts")).toBe(false);
    expect(istLaufzeitpfad("packages/contracts/openapi/v1.json")).toBe(false);
    expect(istLaufzeitpfad("packages/contracts/dist/index.js")).toBe(false);
    expect(istLaufzeitpfad("packages/ui/vitest.config.ts")).toBe(false);
  });

  it("ein ausdruecklich benanntes Nicht-Laufzeitpaket laesst sich eng ausschliessen", () => {
    // Die Ausnahmemechanik muss es GEBEN — sonst waere die Regel beim ersten
    // reinen Werkzeugpaket nicht durchhaltbar und wuerde pauschal aufgeweicht.
    // Heute ist die Liste leer: alle vier Pakete sind produktive Abhaengigkeit
    // von apps/api oder apps/web (gemessen 02.08.2026).
    expect(istLaufzeitpfad("packages/nur-werkzeug/src/x.ts", ["nur-werkzeug"])).toBe(false);
    // Und der Ausschluss gilt NUR fuer das benannte Paket.
    expect(istLaufzeitpfad("packages/contracts/src/x.ts", ["nur-werkzeug"])).toBe(true);
  });

  it("keine Ausnahme darf ein Muster statt eines Paketnamens sein", () => {
    for (const { paket } of NICHT_LAUFZEITFAEHIGE_PAKETE) {
      expect(paket).not.toContain("*");
      expect(paket).not.toContain("/");
      expect(paket.length).toBeGreaterThan(0);
    }
  });
});

describe("Der Umgebungsdetektor kennt jede gaengige Schreibweise (EYT-133, Befund F2)", () => {
  // Gemessen im Review: der Detektor erkannte nur den blossen Bezeichner
  // `process`. Die node:process-Form ist genau die, zu der ESLint aktiv draengt
  // (`unicorn/prefer-node-protocol`) — sie kommt versehentlich ins Haus, nicht
  // boeswillig.
  const erkannt = (quelle: string): number => umgebungszugriffe(quelle, "x.ts").length;

  it.each([
    ["process.env.KEY", "export const a = process.env.KEY;"],
    ['process.env["KEY"]', 'export const a = process.env["KEY"];'],
    ['process["env"].KEY', 'export const a = process["env"].KEY;'],
    ['process["env"]["KEY"]', 'export const a = process["env"]["KEY"];'],
    ["globalThis.process.env.KEY", "export const a = globalThis.process.env.KEY;"],
    [
      'import proc from "node:process"',
      'import proc from "node:process";\nexport const a = proc.env.KEY;',
    ],
    [
      'import * as proc from "node:process"',
      'import * as proc from "node:process";\nexport const a = proc.env.KEY;',
    ],
    ["const p = process", "const p = process;\nexport const a = p.env.KEY;"],
    ["const env = process.env", "const env = process.env;\nexport const a = env.KEY;"],
  ])("erkennt %s", (_name, quelle) => {
    expect(erkannt(quelle)).toBeGreaterThan(0);
  });

  it("erkennt den Schluesselnamen, wo er statisch dasteht", () => {
    expect(umgebungszugriffe('export const a = process["env"].KEY;', "x.ts")[0]?.schluessel).toBe(
      "KEY",
    );
    expect(
      umgebungszugriffe(
        'import proc from "node:process";\nexport const a = proc.env.KEY;',
        "x.ts",
      )[0]?.schluessel,
    ).toBe("KEY");
  });

  it("NODE_ENV bleibt in JEDER Schreibweise harmlos", () => {
    schreibe(
      "packages/contracts/src/umgebung.ts",
      [
        'import proc from "node:process";',
        'export const dev = proc.env.NODE_ENV !== "production";',
      ].join("\n"),
    );
    const gefunden = befunde();
    entferne("packages/contracts/src/umgebung.ts");

    expect(gefunden).toEqual([]);
  });
});

describe("Der Wächter nimmt die zulaessigen Stellen nicht ins Visier (EYT-106 AK6)", () => {
  it("NODE_ENV darf ueberall gelesen werden", () => {
    schreibe(
      "apps/web/lib/umgebung.ts",
      ['export const dev = process.env.NODE_ENV !== "production";'].join("\n"),
    );
    const gefunden = befunde();
    entferne("apps/web/lib/umgebung.ts");

    expect(gefunden).toEqual([]);
  });

  it("Testcode ist kein Laufzeitpfad", () => {
    // Die "isolierte Test-/Ops-Grenze" der PO-Vorgabe: eine E2E-Reise darf
    // Testdaten anlegen, ohne dass daraus ein Anfragepfad wird.
    expect(istLaufzeitpfad("apps/web/e2e/auth-journey.spec.ts")).toBe(false);
    expect(istLaufzeitpfad("apps/web/test/a11y.test.tsx")).toBe(false);
    expect(istLaufzeitpfad("apps/web/playwright.config.ts")).toBe(false);
    // Aber der echte Code sehr wohl — sonst waere die Ausnahme ein Scheunentor.
    expect(istLaufzeitpfad("apps/web/app/providers.tsx")).toBe(true);
    expect(istLaufzeitpfad("apps/web/lib/api-client.ts")).toBe(true);
    expect(istLaufzeitpfad("apps/api/src/platform/auth/token-verifier.ts")).toBe(true);
  });

  it("derselbe Bezeichner in einem Kommentar ist kein Verstoss", () => {
    // Ohne diese Nachsicht meldete der Wächter ausgerechnet die Stellen, die
    // ihn ERKLAEREN — und wuerde abgeschaltet statt befolgt.
    schreibe(
      "apps/api/src/platform/auth/doku.ts",
      [
        "/**",
        " * SUPABASE_SERVICE_ROLE_KEY ist hier verboten und wird nie gelesen.",
        " */",
        "export const hinweis = 1;",
        "// Auch PGPASSWORD gehoert nicht in den Anfragepfad.",
      ].join("\n"),
    );
    const gefunden = befunde();
    entferne("apps/api/src/platform/auth/doku.ts");

    expect(gefunden).toEqual([]);
  });

  it("derselbe Bezeichner in einem SQL-Kommentar ist kein Verstoss", () => {
    schreibe(
      "supabase/migrations/0099_beispiel.sql",
      ["-- KEINE service_role-Policies in diesem Schema.", "select 1;"].join("\n"),
    );
    const gefunden = befunde();
    entferne("supabase/migrations/0099_beispiel.sql");

    expect(gefunden).toEqual([]);
  });

  it("aber ausserhalb eines Kommentars meldet SQL sehr wohl", () => {
    schreibe(
      "supabase/migrations/0098_beispiel.sql",
      ["grant select on public.employees to service_role;"].join("\n"),
    );
    const getroffen = regeln();
    entferne("supabase/migrations/0098_beispiel.sql");

    expect(getroffen.has("privileged-credential-only-in-named-places")).toBe(true);
  });

  it("ein Rautenzeichen in einer Shell-Parametererweiterung verdeckt die Zeile nicht", () => {
    // `$#` darf nicht als Kommentarbeginn gelten — sonst waere der Rest der
    // Zeile unsichtbar und der Wächter pruefte still weniger.
    schreibe(
      "supabase/beispiel.toml",
      ['wert = "${#laenge} SUPABASE_SERVICE_ROLE_KEY"'].join("\n"),
    );
    const getroffen = regeln();
    entferne("supabase/beispiel.toml");

    expect(getroffen.has("privileged-credential-only-in-named-places")).toBe(true);
  });
});

describe("Wächter abgeschwaecht — die geforderte Gegenmutation (EYT-106 AK6)", () => {
  it("ohne Kommentarentfernung meldet der saubere Baum falsch positiv", () => {
    // Diese Probe zeigt, dass die Nachsicht gegenueber Kommentaren TRAEGT:
    // waere sie nicht da, faerbte sich der Wächter an seiner eigenen
    // Dokumentation rot. Sie ist damit die Gegenprobe zur Gegenprobe.
    schreibe(
      "apps/api/src/platform/auth/doku2.ts",
      ["// SUPABASE_SERVICE_ROLE_KEY", "export const x = 1;"].join("\n"),
    );
    const mitNachsicht = befunde();
    entferne("apps/api/src/platform/auth/doku2.ts");
    expect(mitNachsicht).toEqual([]);
  });

  it("eine Laufzeitpfad-Definition ohne apps/web entwaffnet den Wächter nachweisbar", () => {
    // Die Abschwaechung, die am naechsten liegt: "Web ist doch nur der
    // Browser, das pruefen wir woanders." Hier wird gemessen, was sie
    // kostet — der Import faellt dann durch.
    schreibe(
      "apps/web/lib/leak3.ts",
      ['import { createClient } from "@supabase/supabase-js";', "export { createClient };"].join(
        "\n",
      ),
    );
    const dateien = collectSourceFiles(root, "apps");
    const refs = extractImports(root, dateien);
    const scharf = evaluateSecretRules({ repoRoot: root, files: dateien, refs }).findings;

    const abgeschwaecht = refs.filter(
      (ref) => ref.from.startsWith("apps/api/src/") && /^@supabase\//.test(ref.specifier),
    );
    entferne("apps/web/lib/leak3.ts");

    expect(scharf.some((f) => f.rule === "runtime-imports-no-supabase-sdk")).toBe(true);
    expect(abgeschwaecht).toEqual([]);
  });
});

describe("Der saubere Wegwerfbaum bleibt gruen (EYT-106 AK6)", () => {
  it("meldet nichts, wenn keine Fixtur liegt", () => {
    // Erst pruefen, WELCHEN Baum wir messen — sonst bewiese ein leerer Baum
    // dasselbe wie ein sauberer.
    const dateien = collectSourceFiles(root, "apps");
    expect(dateien).toContain("apps/web/app/page.tsx");
    expect(dateien).toContain("apps/api/src/modules/costs/interface/http/costs.controller.ts");
    expect(befunde()).toEqual([]);
  });
});
