import net from "node:net";
import { describe, expect, it } from "vitest";

import { bootstrapWorker } from "../src/worker";

/** Attempts a TCP connection; resolves true when something listens on the port. */
function isPortListening(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (listening: boolean): void => {
      socket.destroy();
      resolve(listening);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

describe("worker bootstrap", () => {
  it("returns an application context without an HTTP server", async () => {
    const ctx = await bootstrapWorker(
      () => () =>
        Promise.resolve({
          role: "easytree_app",
          isSuperuser: false,
          bypassesRls: false,
          inheritsPrivileges: false,
        }),
    );
    try {
      expect((ctx as { getHttpServer?: unknown }).getHttpServer).toBeUndefined();
    } finally {
      await ctx.close();
    }
  });

  it("opens no HTTP listener on the configured API port", async () => {
    const apiPort = Number(process.env["API_PORT"]);
    expect(Number.isInteger(apiPort)).toBe(true);
    const ctx = await bootstrapWorker(
      () => () =>
        Promise.resolve({
          role: "easytree_app",
          isSuperuser: false,
          bypassesRls: false,
          inheritsPrivileges: false,
        }),
    );
    try {
      expect(await isPortListening(apiPort)).toBe(false);
    } finally {
      await ctx.close();
    }
  });
});

describe("worker bootstrap — Rollen-Gate (EYT-45)", () => {
  it("startet nicht, wenn die Datenbankrolle Superuser ist", async () => {
    // Beweist die VERDRAHTUNG, nicht nur die reine Funktion: der Einspritzpunkt
    // ist da, damit Tests keine Datenbank brauchen — nicht, damit die Pruefung
    // im Produktivpfad umgangen werden kann.
    await expect(
      bootstrapWorker(
        () => () =>
          Promise.resolve({
            role: "postgres",
            isSuperuser: true,
            bypassesRls: false,
            inheritsPrivileges: false,
          }),
      ),
    ).rejects.toThrow(/Superuser/);
  });

  it("startet nicht, wenn die Rolle nicht ermittelbar ist", async () => {
    await expect(
      bootstrapWorker(() => () => Promise.reject(new Error("ECONNREFUSED"))),
    ).rejects.toThrow(/fail-closed/);
  });
});
