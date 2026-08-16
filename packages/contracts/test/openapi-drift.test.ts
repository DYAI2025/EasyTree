import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CostSnapshotSchema, DurationMillisecondsSchema } from "../src/costs/schemas.js";
import {
  API_BASE_PATH,
  API_VERSION,
  buildOpenApiDocument,
  serializeOpenApiDocument,
  weekKeyParam,
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
      // Sitzungsoperationen (EYT-106): ein wiederholtes Login erzeugt keine
      // zweite Fachtatsache, sondern dieselbe Sitzung erneut; Logout ist
      // idempotent per Definition. Der Pflichtschluessel bleibt fachlichen
      // Kommandos vorbehalten (Begruendung: src/auth/gateway.ts).
      if (path.startsWith("/auth/")) continue;
      const params = (op["parameters"] ?? []) as Array<{ name: string; required: boolean }>;
      const header = params.find((p) => p.name === "Idempotency-Key");
      expect(header, `${path} ohne Idempotency-Key`).toBeDefined();
      expect(header?.required).toBe(true);
    }
  });

  it("misst die Ehrlichkeitszusage des Kostenschnappschusses (EYT-109)", () => {
    // ## Warum dieser Fall existiert
    //
    // `openapi/document.ts` traegt bei den Kostenschemata einen
    // Ehrlichkeitsabsatz: zwei Zod-Regeln fallen bei der Erzeugung weg —
    // die Beziehung `days` <-> `positions` aus `CostSnapshotSchema.superRefine`
    // und `DurationMillisecondsSchema.refine(> 0)` — und werden statt dessen zur
    // Laufzeit erzwungen. Bis hierher war dieser Absatz reine Prosa.
    // `openapi-drift.test.ts` konnte ihn nicht schuetzen: eine geloeschte
    // `.refine()` aendert `v1.json` um kein Byte, genau deshalb gibt es die
    // Luecke ueberhaupt. Damit war der Absatz die dritte unbelegte Zusicherung
    // dieses Slices — nach dem `strictObject`-Versprechen, das nur eines von
    // sechs Schemata deckte, und dem `toHaveLength(7)` ueber acht Stellen.
    //
    // Der Satz hat ZWEI Haelften, und beide werden hier gemessen, weil er in
    // beide Richtungen verrotten kann:
    //   * Nimmt jemand die Zod-Regel heraus, ist sie auch zur Laufzeit weg —
    //     die Haelfte "wird zur Laufzeit erzwungen" wird rot.
    //   * Faengt ein kuenftiges zod / `z.toJSONSchema` an, dafuer doch etwas
    //     auszugeben, wird die Haelfte "steht nicht im Vertrag" rot. Auch das
    //     will man wissen: dann gehoert der Absatz geloescht, nicht gepflegt.
    const schemas = (doc["components"] as { schemas: Record<string, Record<string, unknown>> })
      .schemas;

    // Vakanzschutz zuerst. Ohne ihn waere jede "… ist nicht vorhanden"-Aussage
    // unten auch bei einem Tippfehler im Komponentennamen gruen.
    const snapshot = schemas["CostSnapshot"];
    expect(snapshot, "Komponente CostSnapshot fehlt — der Rest misst nichts").toBeDefined();
    const felder = (snapshot?.["properties"] ?? {}) as Record<string, Record<string, unknown>>;
    expect(Object.keys(felder)).toEqual(expect.arrayContaining(["days", "positions"]));
    const dauer = (
      schemas["CostPositionDto"]?.["properties"] as Record<string, unknown> | undefined
    )?.["durationMilliseconds"] as Record<string, unknown> | undefined;
    expect(dauer, "CostPositionDto.durationMilliseconds nicht gefunden").toBeDefined();
    // Und das Muster selbst, nicht nur sein Elternobjekt. Ohne diese Zeile
    // stuende unten `new RegExp(undefined as string)` — das ergibt /undefined/,
    // und `/undefined/.test("0")` ist `true`. Die Zusicherung waere also auch
    // dann gruen, wenn zod gar kein `pattern` mehr ausgibt: ein Satz ueber ein
    // Muster, das es nicht gibt.
    expect(
      typeof dauer?.["pattern"],
      "durationMilliseconds hat kein `pattern` mehr — die Musteraussage unten misst dann nichts",
    ).toBe("string");
    const dauerMuster = dauer?.["pattern"];

    // Jede Meldung endet mit derselben Handlungsanweisung. Eine Meldung, die
    // nur eine Tatsache nennt, laesst den naechsten Leser raten, ob er die
    // Regel oder den Absatz reparieren soll — es ist immer genau eines von
    // beiden.
    const WAS_TUN =
      " Entweder die Regel wiederherstellen oder den Ehrlichkeitsabsatz in " +
      "src/openapi/document.ts loeschen.";

    // (1) Die Beziehung zwischen zwei Feldern steht nicht im Dokument.
    // Die Liste nennt, was gefunden WURDE, statt nur "ungleich" zu melden.
    const beziehung = [
      "allOf",
      "anyOf",
      "oneOf",
      "not",
      "if",
      "then",
      "else",
      "dependentSchemas",
      "dependentRequired",
    ].filter((schluessel) => snapshot !== undefined && schluessel in snapshot);
    expect(
      beziehung,
      "CostSnapshot traegt jetzt Schluesselwoerter, mit denen sich eine Feldbeziehung " +
        "ausdruecken laesst. Entweder wird die Regel nun doch abgebildet, oder hier " +
        "entstand etwas Unbeabsichtigtes." +
        WAS_TUN,
    ).toEqual([]);
    expect(
      felder["days"]?.["minItems"],
      "days hat jetzt minItems; das waere eine TEILWEISE Abbildung der Regel und macht " +
        "den Absatz ungenau." +
        WAS_TUN,
    ).toBeUndefined();

    // (2) "Dauer > 0" steht nicht im Dokument — belegt am Muster selbst, nicht
    // an der Abwesenheit eines Schluessels: das erzeugte Schema nimmt "0" an.
    // `String(...)` statt eines `as`-Casts: die Zusicherung oben hat den Typ
    // bereits gemessen, und ein Cast waere zur Laufzeit ohnehin geloescht.
    expect(
      new RegExp(String(dauerMuster)).test("0"),
      "Das erzeugte Muster fuer durationMilliseconds lehnt '0' inzwischen ab — die Regel " +
        "steht also doch im Vertrag." +
        WAS_TUN,
    ).toBe(true);
    const numerisch = ["minimum", "exclusiveMinimum", "const", "enum"].filter(
      (schluessel) => dauer !== undefined && schluessel in dauer,
    );
    expect(
      numerisch,
      "durationMilliseconds traegt jetzt eine numerische Schranke." + WAS_TUN,
    ).toEqual([]);

    // (3) Die andere Haelfte des Satzes: erzwungen wird beides trotzdem.
    // Bewusst knapp — die vollstaendige Abdeckung liegt in
    // `costs-snapshot-schemas.test.ts`. Hier stehen genau die zwei Regeln, die
    // der Absatz namentlich nennt, damit er nicht ueberlebt, wenn sie fallen.
    expect(
      DurationMillisecondsSchema.safeParse("0").success,
      "Die Regel 'Dauer > 0' gibt es nicht mehr — dann behauptet der Absatz eine " +
        "Laufzeitpruefung, die niemand mehr macht." +
        WAS_TUN,
    ).toBe(false);
    const id = "3f1c9c2a-5b7e-4d21-9f0a-8c6e2b1d4a77";
    const ohneTagessumme = {
      id,
      planVersionId: id,
      worksiteId: null,
      weekKey: "2026-W32",
      timeZone: "Europe/Berlin",
      currency: "EUR",
      ruleVersion: "personnel-plan-cost-v1",
      createdAt: "2026-08-08T10:00:00.000Z",
      createdBy: id,
      correlationId: "abc",
      totalMinorUnits: "12000",
      days: [],
      positions: [
        {
          id,
          assignmentId: id,
          worksiteId: id,
          worksiteLabel: "Baustelle Nord",
          employeeId: id,
          employeeLabel: "Mira Baumgart",
          localDate: "2026-08-03",
          durationMilliseconds: "28800000",
          rateVersionId: id,
          amountMinorUnits: "12000",
        },
      ],
    };
    expect(
      CostSnapshotSchema.safeParse(ohneTagessumme).success,
      "Die Beziehung days <-> positions wird nicht mehr geprueft — dann behauptet der " +
        "Absatz eine Laufzeitpruefung, die niemand mehr macht." +
        WAS_TUN,
    ).toBe(false);
  });

  it("leitet die Wochenbereichsparameter aus weekKeyParam ab, statt sie zu kopieren", () => {
    // `wochenbereichParam` setzt seine Beschreibung aus `weekKeyParam.description`
    // zusammen, damit die dortige Ehrlichkeit zur Kalenderregel nicht bei einer
    // Kopie verlorengeht. Nichts hielt das bisher fest: ersetzt man die
    // Interpolation durch den heutigen Wortlaut, bleibt `v1.json` byteweise
    // gleich und der Drift-Test gruen — die Kopplung waere weg und niemand
    // merkte es.
    //
    // Gemessen wird die Kopplung, nicht der Wortlaut. Der Fall faengt damit
    // auch die unangenehmere Variante: schreibt jemand `weekKeyParam.description`
    // um und beginnt sie mit "Der Parameter weekKey enthaelt …", stuende das
    // im veroeffentlichten Vertrag unter `fromWeekKey` und benennte den
    // falschen Parameter.
    const parameter = (paths["/kosten/planversionen"]?.["get"]?.["parameters"] ?? []) as Array<{
      name: string;
      description: string;
    }>;
    expect(parameter.map((p) => p.name)).toEqual(["fromWeekKey", "toWeekKey"]);
    for (const p of parameter) {
      expect(
        p.description,
        `${p.name} traegt den Text von weekKeyParam nicht mehr — entweder wurde die ` +
          "Ableitung durch eine Kopie ersetzt, oder weekKeyParam.description wurde " +
          "umformuliert, ohne wochenbereichParam mitzudenken.",
      ).toContain(weekKeyParam.description);
      // Gegenprobe: die Beschreibung ist mehr als der uebernommene Text, sonst
      // waere die Rolle des Parameters verlorengegangen.
      expect(p.description.length).toBeGreaterThan(weekKeyParam.description.length);
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
