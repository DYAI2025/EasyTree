import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  API_BASE_PATH,
  API_VERSION,
  buildOpenApiDocument,
  serializeOpenApiDocument,
} from "../src/openapi/document.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const committedPath = resolve(packageRoot, "openapi/v1.json");

describe("OpenAPI-Drift", () => {
  it("das eingecheckte Dokument entspricht byteweise den Schemata", () => {
    // Der Kern von EYT-47 AK 4: aendert jemand ein Zod-Schema, ohne
    // `openapi:write` laufen zu lassen, wird dieser Test rot. Ein Byte-Vergleich
    // statt eines Struktur-Vergleichs, weil das Dokument eingecheckt ist und
    // Reviewer den Diff lesen koennen sollen.
    const committed = readFileSync(committedPath, "utf8");
    expect(serializeOpenApiDocument()).toBe(committed);
  });

  it("ist reproduzierbar — zweimal erzeugen ergibt dasselbe Byte fuer Byte", () => {
    expect(serializeOpenApiDocument()).toBe(serializeOpenApiDocument());
  });
});

describe("Vertragsform", () => {
  const doc = buildOpenApiDocument();
  const paths = doc["paths"] as Record<string, Record<string, Record<string, unknown>>>;
  const operations = Object.entries(paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({ path, method, op })),
  );

  it("hat ueberhaupt Operationen und Schemata", () => {
    expect(operations.length).toBeGreaterThan(5);
    const schemas = (doc["components"] as { schemas: Record<string, unknown> }).schemas;
    expect(Object.keys(schemas).length).toBeGreaterThan(10);
  });

  it("ist unter /api/v1 versioniert", () => {
    expect(doc["servers"]).toEqual([{ url: API_BASE_PATH }]);
    expect((doc["info"] as { version: string }).version).toBe(API_VERSION);
  });

  it.each(["400", "401", "403", "409"])(
    "verweist bei %s ueberall auf dasselbe Fehlerschema",
    (status) => {
      for (const { path, method, op } of operations) {
        const responses = op["responses"] as Record<string, unknown>;
        const response = responses[status] as
          { content: { "application/json": { schema: { $ref: string } } } } | undefined;
        expect(response, `${method.toUpperCase()} ${path} ohne ${status}`).toBeDefined();
        expect(response?.content["application/json"].schema.$ref).toBe(
          "#/components/schemas/ProblemDocument",
        );
      }
    },
  );

  it("verlangt bei jedem schreibenden Aufruf einen Idempotenzschluessel", () => {
    const writes = operations.filter(({ method }) => method === "post");
    expect(writes.length).toBeGreaterThan(3);
    for (const { path, op } of writes) {
      // Validierung ist seiteneffektfrei und braucht daher keinen Schluessel.
      if (path.endsWith("/validierung")) continue;
      const params = (op["parameters"] ?? []) as Array<{ name: string; required: boolean }>;
      const header = params.find((p) => p.name === "Idempotency-Key");
      expect(header, `${path} ohne Idempotency-Key`).toBeDefined();
      expect(header?.required).toBe(true);
    }
  });

  it("schliesst jedes Antwortobjekt gegen unbekannte Felder", () => {
    // z.object wuerde unbekannte Schluessel still entfernen und Erfolg melden —
    // ein undokumentiertes Feld (interne Kosten, fremde orgId) kaeme unbemerkt
    // ueber die Leitung. Deshalb ueberall z.strictObject.
    const schemas = (doc["components"] as { schemas: Record<string, Record<string, unknown>> })
      .schemas;
    const open = Object.entries(schemas)
      .filter(([, schema]) => schema["type"] === "object")
      .filter(([, schema]) => schema["additionalProperties"] !== false)
      .map(([name]) => name);
    expect(open).toEqual([]);
  });
});
