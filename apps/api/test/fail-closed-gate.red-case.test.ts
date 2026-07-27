/**
 * Rot-Fall-Beweis fuer das Zaehlwerk der fail-closed-Suiten (EYT-71).
 *
 * Ein Report, der nie eine Diskrepanz gezeigt hat, ist kein Report. Diese Suite
 * treibt `FailClosedGate` aus `test/tenant-context.helper.ts` — also exakt den
 * Code, den die Tenant-Suiten benutzen, nicht eine Nachbildung — mit einer
 * synthetisch fehlschlagenden Assertion und verlangt, dass die Zahlen das
 * sichtbar machen.
 *
 * Hintergrund: `executed` stieg frueher VOR der Assertion. Ein fehlgeschlagener
 * Pflichttest zaehlte damit als "ausgefuehrt", und `executed=7 skipped=0` in der
 * GitHub-Step-Summary las sich wie sieben bestandene Sicherheitstests. Der Lauf
 * war zwar rot (vitest' Exitcode propagiert durch `| tee`, weil die CI-Steps
 * `shell: bash` und damit `-eo pipefail` setzen) — aber der Report log.
 *
 * Braucht keine Datenbank: das Zaehlwerk ist bewusst frei von pg und vitest.
 */
import { describe, expect, it } from "vitest";

import { FailClosedGate } from "./tenant-context.helper";

const OK = async (): Promise<void> => {};
const BOOM = async (): Promise<void> => {
  throw new Error("synthetische Assertion, absichtlich rot");
};

describe("FailClosedGate — Rot-Faelle (EYT-71)", () => {
  it("ein fehlgeschlagener Test erzeugt passed < executed", async () => {
    const gate = new FailClosedGate("probe", "required", "EYT-71");
    await gate.run(OK);
    await expect(gate.run(BOOM)).rejects.toThrow("synthetische Assertion");
    await gate.run(OK);

    expect(gate.counts()).toEqual({ executed: 3, passed: 2, skipped: 0 });
  });

  it("die Reportzeile verschleiert den Fehlschlag nicht", async () => {
    const gate = new FailClosedGate("probe", "required", "EYT-71");
    await gate.run(OK);
    await expect(gate.run(BOOM)).rejects.toThrow();

    const line = gate.reportLine();
    expect(line).toContain("executed=2");
    expect(line).toContain("passed=1");
    // Die frueher allein stehende Zahl haette hier "executed=2 skipped=0"
    // gemeldet und damit zwei bestandene Tests suggeriert.
    expect(line).not.toContain("passed=2");
  });

  it("required-Modus wirft, wenn nicht jeder ausgefuehrte Test bestanden ist", async () => {
    const gate = new FailClosedGate("probe", "required", "EYT-71");
    await gate.run(OK);
    await expect(gate.run(BOOM)).rejects.toThrow();

    expect(() => gate.assertOrThrow()).toThrow(/1 von 2 Pflichttests sind nicht bestanden/);
  });

  it("required-Modus wirft weiterhin bei Skips (EYT-66 bleibt wirksam)", async () => {
    const gate = new FailClosedGate("probe", "required", "EYT-71");
    gate.markSkipped();
    expect(() => gate.assertOrThrow()).toThrow(/1 Pflichttests uebersprungen/);
  });

  it("Skip hat Vorrang vor der passed-Pruefung, damit die Meldung die Ursache nennt", async () => {
    const gate = new FailClosedGate("probe", "required", "EYT-71");
    gate.markSkipped();
    await gate.run(OK);
    await expect(gate.run(BOOM)).rejects.toThrow();
    expect(() => gate.assertOrThrow()).toThrow(/uebersprungen/);
  });

  it("vollstaendig gruener Lauf wirft nicht", async () => {
    const gate = new FailClosedGate("probe", "required", "EYT-71");
    await gate.run(OK);
    await gate.run(OK);

    expect(gate.counts()).toEqual({ executed: 2, passed: 2, skipped: 0 });
    expect(gate.reportLine()).toBe("[probe] mode=required executed=2 passed=2 skipped=0\n");
    expect(() => gate.assertOrThrow()).not.toThrow();
  });

  it("local-Modus wirft nie — der Opt-out bleibt ein Opt-out", async () => {
    const gate = new FailClosedGate("probe", "local", "EYT-71");
    gate.markSkipped();
    await gate.run(OK);
    await expect(gate.run(BOOM)).rejects.toThrow();

    expect(() => gate.assertOrThrow()).not.toThrow();
    expect(gate.reportLine()).toContain("mode=local");
  });
});
