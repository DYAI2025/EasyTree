import { describe, expect, it } from "vitest";

import {
  InvalidNextOutputError,
  NEXT_OUTPUT_STANDALONE,
  resolveNextOutput,
} from "../lib/next-output";

/**
 * EYT-126 — die Ausgabeform des Next-Builds.
 *
 * Gegenmutation, die diesen Block rot macht: in `resolveNextOutput` den
 * `throw` durch `return {}` ersetzen. Dann meldet der Fall „unbekannter Wert"
 * keinen Fehler mehr, und das Image baute still ohne `standalone` — der Fehler
 * fiele erst im Dockerfile auf, wo `apps/web/server.js` fehlt.
 */
describe("resolveNextOutput (EYT-126)", () => {
  it("laesst die Standardausgabe unangetastet, wenn nichts gesetzt ist", () => {
    expect(resolveNextOutput({})).toEqual({});
    expect(resolveNextOutput({ EASYTREE_NEXT_OUTPUT: "" })).toEqual({});
    expect(resolveNextOutput({ EASYTREE_NEXT_OUTPUT: "   " })).toEqual({});
  });

  it("schaltet auf standalone um — das ist die Form, die das Image braucht", () => {
    expect(resolveNextOutput({ EASYTREE_NEXT_OUTPUT: NEXT_OUTPUT_STANDALONE })).toEqual({
      output: "standalone",
    });
    expect(resolveNextOutput({ EASYTREE_NEXT_OUTPUT: "  standalone  " })).toEqual({
      output: "standalone",
    });
  });

  it("ist fail-closed: ein unbekannter Wert ist ein Tippfehler, kein Wunsch", () => {
    expect(() => resolveNextOutput({ EASYTREE_NEXT_OUTPUT: "standlone" })).toThrow(
      InvalidNextOutputError,
    );
    // Die Meldung nennt den erhaltenen Wert — sonst sucht man den Tippfehler
    // in der falschen Datei.
    expect(() => resolveNextOutput({ EASYTREE_NEXT_OUTPUT: "export" })).toThrow(/"export"/);
  });

  it("nimmt eine ProcessEnv-artige Umgebung an, ohne sie zu verengen", () => {
    // Der Grund fuer den Index-Typ: `process.env` traegt viele Schluessel, die
    // hier niemanden interessieren. Ein Objekttyp mit genau einem optionalen
    // Feld wurde von TypeScript als Schwachtyp abgelehnt.
    const umgebung: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      PATH: "/bin",
      EASYTREE_NEXT_OUTPUT: "standalone",
    };
    expect(resolveNextOutput(umgebung)).toEqual({ output: "standalone" });
  });
});
