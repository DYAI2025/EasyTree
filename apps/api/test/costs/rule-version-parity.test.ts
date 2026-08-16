/**
 * Paritaet der Regelversion zwischen Vertrag und Domain (EYT-109).
 *
 * ## Warum es diesen Test gibt
 *
 * Die Regelversion des Kostenpfads steht an zwei Stellen, und das ist kein
 * Versehen:
 *
 *   packages/domain/src/cost-position.ts     COST_RULE_VERSION — womit gerechnet wird
 *   packages/contracts/src/costs/schemas.ts  z.literal(…)      — was ueber die Leitung darf
 *
 * Zusammenlegen ginge nicht ohne Schaden: `@easytree/contracts` ist
 * transport-only und fuehrt `@easytree/domain` bewusst weder als Abhaengigkeit
 * noch als Import (Architekturtest). Jede Seite ist fuer sich festgenagelt —
 * aber NICHTS hielt sie bisher aneinander.
 *
 * Der konkrete Schaden ohne diese Klammer: wer die Domainkonstante auf `-v2`
 * hebt, macht genau einen Test in `money-rate.test.ts` rot, der nichts ueber
 * den Vertrag aussagt. Der Vertrag bleibt bei `-v1` und gruen. Danach schreibt
 * die API `-v2` in eine Antwort, die ihr eigenes Antwortschema ablehnt: ein
 * `CONTRACT_VIOLATION` zur Laufzeit, gefunden irgendwo im Integrationspfad
 * statt hier in `unit-tests`.
 *
 * Dieser Test liegt in `apps/api/test`, weil nur `apps/api` beide Pakete sieht.
 * Dieselbe Bauart wie `iso-week-parity.test.ts` und
 * `domain-invariant-coverage.test.ts`.
 *
 * ## Gegenmutation
 *
 * Eine der beiden Seiten aendern — etwa `COST_RULE_VERSION` auf
 * `"personnel-plan-cost-v2"` setzen, ohne das Literal im Vertrag mitzuziehen.
 * Dann wird dieser Test rot und nennt beide Werte.
 *
 * ## Wenn V2 wirklich kommt
 *
 * Dann wird aus dem Literal ein `z.enum([…v1, …v2])` und NICHT ein ersetztes
 * Literal — Snapshots sind unveraenderliche historische Dokumente, die nach V1
 * gerechneten bleiben lesbar. Dieser Test wandert dann von „gleich" auf
 * „enthalten": der Vertrag muss die AKTUELLE Domainversion kennen und die
 * alten weiter annehmen.
 */
import { CostSnapshotSchema } from "@easytree/contracts";
import { COST_RULE_VERSION } from "@easytree/domain";
import { describe, expect, it } from "vitest";

describe("Regelversion des Kostenpfads", () => {
  it("Transportvertrag und Domainkonstante nennen dieselbe Regelversion", () => {
    expect(CostSnapshotSchema.shape.ruleVersion.value).toBe(COST_RULE_VERSION);
  });

  it("der Vertrag nimmt genau die Version an, mit der die Domain rechnet", () => {
    // Zweite Richtung, verhaltensbasiert: die Gleichheit oben liest eine
    // Schemainterna, dieser Fall prueft die WIRKUNG. Beide zusammen ueberleben
    // auch einen Umbau des Schemas auf `z.enum`.
    const rumpf = {
      id: "3f1c9c2a-5b7e-4d21-9f0a-8c6e2b1d4a77",
      planVersionId: "9a2b7c1d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
      worksiteId: null,
      weekKey: "2026-W32",
      timeZone: "Europe/Berlin",
      currency: "EUR",
      createdAt: "2026-08-08T10:00:00.000Z",
      createdBy: "3f1c9c2a-5b7e-4d21-9f0a-8c6e2b1d4a77",
      correlationId: "abc",
      totalMinorUnits: "0",
      days: [],
      positions: [],
    };
    expect(CostSnapshotSchema.safeParse({ ...rumpf, ruleVersion: COST_RULE_VERSION }).success).toBe(
      true,
    );
  });
});
