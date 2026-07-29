/**
 * Kanonische PlanningGateway-Vertragssuite (EYT-103).
 *
 * Dieser Subpfad ist Testinfrastruktur, kein produktiver Vertragsexport. Er
 * führt exakt dieselben beobachtbaren Fälle gegen jede Gateway-Implementierung
 * aus. Datenbank- und NestJS-Aufbau bleiben Sache des jeweiligen Harnesses.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanningGateway } from "../planning/gateway.js";
import {
  AssignmentDtoSchema,
  PlanValidationResultSchema,
  PlanningWindowSchema,
  type CreateAssignmentCommand,
  type ValidatePlanCommand,
} from "../planning/schemas.js";
import { IdempotencyKeySchema } from "../primitives.js";

export const PLANNING_GATEWAY_CONTRACT_FIXTURE = {
  weekKey: "2026-W32",
  employeeId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
  worksiteId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
  existingAssignmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  existingInterval: {
    startUtc: "2026-08-03T06:00:00.000Z",
    endUtc: "2026-08-03T14:00:00.000Z",
  },
  freeInterval: {
    startUtc: "2026-08-04T06:00:00.000Z",
    endUtc: "2026-08-04T14:00:00.000Z",
  },
  alternativeInterval: {
    startUtc: "2026-08-05T06:00:00.000Z",
    endUtc: "2026-08-05T14:00:00.000Z",
  },
  overlappingInterval: {
    startUtc: "2026-08-03T08:00:00.000Z",
    endUtc: "2026-08-03T10:00:00.000Z",
  },
  idempotencyKey: IdempotencyKeySchema.parse("11111111-1111-4111-8111-111111111111"),
} as const;

export const PLANNING_PROBLEM_TYPE = {
  invalidInterval: "urn:easytree:planning:invalid-interval",
  overlap: "urn:easytree:planning:overlapping-assignment",
  idempotencyKeyReused: "urn:easytree:planning:idempotency-key-reused",
} as const;

export const PLANNING_VALIDATION_CODE = {
  overlap: "EMPLOYEE_INTERVAL_OVERLAP",
} as const;

export interface PlanningGatewayContractHarness {
  readonly gateway: PlanningGateway;
  readonly close?: () => Promise<void>;
}

export type PlanningGatewayContractHarnessFactory = () =>
  PlanningGatewayContractHarness | Promise<PlanningGatewayContractHarness>;

function command(interval: CreateAssignmentCommand["interval"]): CreateAssignmentCommand {
  return {
    weekKey: PLANNING_GATEWAY_CONTRACT_FIXTURE.weekKey,
    employeeId: PLANNING_GATEWAY_CONTRACT_FIXTURE.employeeId,
    worksiteId: PLANNING_GATEWAY_CONTRACT_FIXTURE.worksiteId,
    interval,
  };
}

function validation(interval: ValidatePlanCommand["draft"]["interval"]): ValidatePlanCommand {
  return {
    weekKey: PLANNING_GATEWAY_CONTRACT_FIXTURE.weekKey,
    draft: {
      employeeId: PLANNING_GATEWAY_CONTRACT_FIXTURE.employeeId,
      worksiteId: PLANNING_GATEWAY_CONTRACT_FIXTURE.worksiteId,
      interval,
    },
  };
}

/**
 * Registriert den kanonischen Fallsatz beim aufrufenden Vitest-Prozess.
 *
 * Ein frisches Harness pro Fall verhindert, dass Idempotenz- oder
 * Konfliktzustand eines Tests den nächsten grün oder rot färbt.
 */
export function planningGatewayContractSuite(
  implementation: string,
  createHarness: PlanningGatewayContractHarnessFactory,
): void {
  describe(`PlanningGateway-Vertrag: ${implementation}`, () => {
    let harness: PlanningGatewayContractHarness;

    beforeEach(async () => {
      harness = await createHarness();
    });

    afterEach(async () => {
      await harness.close?.();
    });

    it("liest ein vertragskonformes Planungsfenster", async () => {
      const result = await harness.gateway.getPlanningWindow({
        weekKey: PLANNING_GATEWAY_CONTRACT_FIXTURE.weekKey,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(() => PlanningWindowSchema.parse(result.value)).not.toThrow();
      expect(result.value.assignments.map((assignment) => assignment.id)).toContain(
        PLANNING_GATEWAY_CONTRACT_FIXTURE.existingAssignmentId,
      );
    });

    it("erstellt einen gültigen Einsatz vertragskonform", async () => {
      const result = await harness.gateway.createAssignment(
        command(PLANNING_GATEWAY_CONTRACT_FIXTURE.freeInterval),
        { idempotencyKey: PLANNING_GATEWAY_CONTRACT_FIXTURE.idempotencyKey },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(() => AssignmentDtoSchema.parse(result.value)).not.toThrow();
      expect(result.value.interval).toEqual(PLANNING_GATEWAY_CONTRACT_FIXTURE.freeInterval);
    });

    it("lehnt ein ungültiges Intervall mit stabilem Problem-Type ab", async () => {
      const result = await harness.gateway.createAssignment(
        command({
          startUtc: "2026-08-04T06:00:00.000Z",
          endUtc: "2026-08-04T06:00:00.000Z",
        }),
        { idempotencyKey: PLANNING_GATEWAY_CONTRACT_FIXTURE.idempotencyKey },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toBe("REJECTED");
      expect(result.problem?.type).toBe(PLANNING_PROBLEM_TYPE.invalidInterval);
    });

    it("lehnt eine Überlappung mit stabilem Problem-Type ab", async () => {
      const result = await harness.gateway.createAssignment(
        command(PLANNING_GATEWAY_CONTRACT_FIXTURE.overlappingInterval),
        { idempotencyKey: PLANNING_GATEWAY_CONTRACT_FIXTURE.idempotencyKey },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toBe("REJECTED");
      expect(result.problem?.type).toBe(PLANNING_PROBLEM_TYPE.overlap);
    });

    it("wiederholt denselben Vorgang idempotent mit derselben Assignment-ID", async () => {
      const create = command(PLANNING_GATEWAY_CONTRACT_FIXTURE.freeInterval);
      const options = { idempotencyKey: PLANNING_GATEWAY_CONTRACT_FIXTURE.idempotencyKey };
      const first = await harness.gateway.createAssignment(create, options);
      const retry = await harness.gateway.createAssignment(create, options);
      expect(first.ok).toBe(true);
      expect(retry.ok).toBe(true);
      if (!first.ok || !retry.ok) return;
      expect(retry.value.id).toBe(first.value.id);
    });

    it("lehnt denselben Schlüssel mit abweichendem Request-Fingerprint ab", async () => {
      const options = { idempotencyKey: PLANNING_GATEWAY_CONTRACT_FIXTURE.idempotencyKey };
      const first = await harness.gateway.createAssignment(
        command(PLANNING_GATEWAY_CONTRACT_FIXTURE.freeInterval),
        options,
      );
      expect(first.ok).toBe(true);

      const changed = await harness.gateway.createAssignment(
        command(PLANNING_GATEWAY_CONTRACT_FIXTURE.alternativeInterval),
        options,
      );
      expect(changed.ok).toBe(false);
      if (changed.ok) return;
      expect(changed.failure).toBe("REJECTED");
      expect(changed.problem?.type).toBe(PLANNING_PROBLEM_TYPE.idempotencyKeyReused);
    });

    it("unterscheidet konfliktfreie und blockierte Validierung", async () => {
      const free = await harness.gateway.validateDraft(
        validation(PLANNING_GATEWAY_CONTRACT_FIXTURE.freeInterval),
      );
      expect(free.ok).toBe(true);
      if (!free.ok) return;
      expect(() => PlanValidationResultSchema.parse(free.value)).not.toThrow();
      expect(free.value.publishable).toBe(true);
      expect(free.value.conflicts).toEqual([]);

      const blocked = await harness.gateway.validateDraft(
        validation(PLANNING_GATEWAY_CONTRACT_FIXTURE.overlappingInterval),
      );
      expect(blocked.ok).toBe(true);
      if (!blocked.ok) return;
      expect(() => PlanValidationResultSchema.parse(blocked.value)).not.toThrow();
      expect(blocked.value.publishable).toBe(false);
      expect(blocked.value.conflicts).toContainEqual(
        expect.objectContaining({
          code: PLANNING_VALIDATION_CODE.overlap,
          blocking: true,
        }),
      );
    });
  });
}
