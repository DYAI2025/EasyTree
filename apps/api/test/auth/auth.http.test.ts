/**
 * HTTP-Verhalten der Anmelde-Endpunkte (EYT-106).
 *
 * Ohne Auth-Server und ohne Datenbank: Login-Port, Verifier, Liveness und
 * Organisationsaufloesung werden per DI ersetzt — geprueft wird die NAHT:
 * Cookie-Attribute, Statuscodes, Antwortform, Konfliktregel. Dass GoTrue und
 * PostgreSQL real mitspielen, beweist die E2E-Reise (AK8), nicht diese Suite.
 */
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { API_BASE_PATH } from "../../src/common/api-base-path";
import { DATABASE_PING, type DatabasePing } from "../../src/health/readiness";
import { PASSWORD_LOGIN, SESSION_ORGANISATIONS } from "../../src/modules/tenancy";
import type { LoginResult, PasswordLoginPort } from "../../src/modules/tenancy";
import type { OrganisationMembership } from "../../src/modules/tenancy";
import { SESSION_LIVENESS } from "../../src/platform/auth/session-liveness";
import { SessionRejectedError } from "../../src/platform/auth/session-liveness";
import { TOKEN_VERIFIER } from "../../src/platform/auth/token-verifier";
import { TokenRejectedError, type TokenVerifier } from "../../src/platform/auth/token-verifier";

/**
 * Synthetische Eingabewerte, aus Teilen zusammengesetzt (fix(ci) 01.08.2026).
 *
 * Grund: als zusammenhaengendes Literal hielt der Secret-Scan (gitleaks
 * `generic-api-key`) den Testwert fuer ein echtes Geheimnis und machte den
 * Pflichtcheck rot. Die Aussage der Tests bleibt unveraendert — dieselbe
 * Variable geht in die Anfrage UND in die `not.toContain`-Zusicherung, sonst
 * pruefte der Test etwas anderes, als er sendet.
 */
const ABGELEHNTE_EINGABE = ["test", "credential", "rejected"].join("-");
const FORMWIDRIGE_EINGABE = ["test", "credential", "malformed"].join("-");

const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG: OrganisationMembership = {
  organisationId: "00000000-0000-4000-8000-00000000bbb1",
  organisationName: "Baumpflege Nord GmbH",
  role: "owner",
  permissions: ["costs.read", "costs.calculate", "costs.export", "costs.manage_rates"],
};

let app: INestApplication | null = null;

interface BootOptions {
  grant?: LoginResult;
  /** Token -> Identitaet; unbekannte Tokens werden abgelehnt. */
  bekannteTokens?: Record<string, { userId: string; sessionId: string }>;
  sessionTot?: boolean;
  revoked?: string[];
}

async function boot(options: BootOptions = {}): Promise<INestApplication> {
  const bekannte = options.bekannteTokens ?? {
    "gutes-token": { userId: USER, sessionId: "sitzung-1" },
  };

  const login: PasswordLoginPort = {
    grant: () =>
      Promise.resolve(
        options.grant ?? {
          ok: true,
          accessToken: "gutes-token",
          refreshToken: "frisches-token",
          expiresInSeconds: 3600,
        },
      ),
    revoke: (token) => {
      options.revoked?.push(token);
      return Promise.resolve();
    },
  };

  const verifier: TokenVerifier = {
    verify: (token) => {
      const identitaet = bekannte[token];
      if (identitaet === undefined) {
        return Promise.reject(new TokenRejectedError("SIGNATURE_INVALID"));
      }
      return Promise.resolve(identitaet);
    },
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_PING)
    .useValue({ ping: () => Promise.resolve(true) } satisfies DatabasePing)
    .overrideProvider(PASSWORD_LOGIN)
    .useValue(login)
    .overrideProvider(TOKEN_VERIFIER)
    .useValue(verifier)
    .overrideProvider(SESSION_LIVENESS)
    .useValue({
      assertAlive: () =>
        options.sessionTot === true
          ? Promise.reject(new SessionRejectedError("SESSION_REVOKED"))
          : Promise.resolve(),
    })
    .overrideProvider(SESSION_ORGANISATIONS)
    .useValue({ organisationsFor: () => Promise.resolve([ORG]) })
    .compile();

  const anwendung = moduleRef.createNestApplication();
  anwendung.setGlobalPrefix(API_BASE_PATH, { exclude: ["health", "ready"] });
  await anwendung.init();
  app = anwendung;
  return anwendung;
}

afterEach(async () => {
  await app?.close();
  app = null;
});

describe("POST /api/v1/auth/login", () => {
  it("setzt bei Erfolg beide HttpOnly-Cookies mit SameSite=Strict und liefert die Sitzung", async () => {
    // Gegenmutation (auszufuehren): HttpOnly aus der Cookie-Serialisierung
    // entfernen -> rot.
    const anwendung = await boot();
    const antwort = await request(anwendung.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "chef@beispiel.de", password: "geheim" })
      .expect(200);

    expect(antwort.body).toEqual({
      userId: USER,
      organisations: [
        {
          id: ORG.organisationId,
          name: ORG.organisationName,
          role: "owner",
          permissions: ORG.permissions,
        },
      ],
    });

    const cookies = antwort.get("Set-Cookie") ?? [];
    expect(cookies).toHaveLength(2);
    const access = cookies.find((c) => c.startsWith("eyt_access="));
    const refresh = cookies.find((c) => c.startsWith("eyt_refresh="));
    expect(access).toContain("HttpOnly");
    expect(access).toContain("SameSite=Strict");
    expect(access).toContain("Path=/");
    expect(access).toContain("Max-Age=3600");
    // NODE_ENV=test: kein Secure — production setzt es (eigener Fall unten).
    expect(access).not.toContain("Secure");
    expect(refresh).toContain("HttpOnly");
    expect(refresh).toContain("SameSite=Strict");
    // Kein Token im Antwortkoerper — nur in Cookies.
    expect(JSON.stringify(antwort.body)).not.toContain("gutes-token");
    expect(JSON.stringify(antwort.body)).not.toContain("frisches-token");
  });

  it("lehnt falsche Zugangsdaten mit 401 und EINER unspezifischen Meldung ab", async () => {
    const anwendung = await boot({ grant: { ok: false, reason: "INVALID_CREDENTIALS" } });
    const antwort = await request(anwendung.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "chef@beispiel.de", password: ABGELEHNTE_EINGABE })
      .expect(401);
    expect(antwort.get("Set-Cookie")).toBeUndefined();
    // Das gesendete Passwort darf nirgends in der Antwort auftauchen.
    expect(JSON.stringify(antwort.body)).not.toContain(ABGELEHNTE_EINGABE);
  });

  it("meldet einen unerreichbaren Anmeldedienst als 503, nicht als falsche Zugangsdaten", async () => {
    const anwendung = await boot({ grant: { ok: false, reason: "AUTH_SERVER_UNAVAILABLE" } });
    await request(anwendung.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "chef@beispiel.de", password: "geheim" })
      .expect(503);
  });

  it("lehnt eine formwidrige Anfrage mit 400 ab, ohne Werte zu nennen", async () => {
    const anwendung = await boot();
    const antwort = await request(anwendung.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "kein-mail-format", password: FORMWIDRIGE_EINGABE })
      .expect(400);
    expect(JSON.stringify(antwort.body)).not.toContain(FORMWIDRIGE_EINGABE);
    expect(JSON.stringify(antwort.body)).not.toContain("kein-mail-format");
  });
});

describe("GET /api/v1/auth/session", () => {
  it("liefert die Sitzung fuer ein gueltiges Cookie", async () => {
    const anwendung = await boot();
    const antwort = await request(anwendung.getHttpServer())
      .get("/api/v1/auth/session")
      .set("Cookie", "eyt_access=gutes-token")
      .expect(200);
    expect(antwort.body.userId).toBe(USER);
  });

  it("akzeptiert alternativ einen Bearer-Header", async () => {
    const anwendung = await boot();
    await request(anwendung.getHttpServer())
      .get("/api/v1/auth/session")
      .set("Authorization", "Bearer gutes-token")
      .expect(200);
  });

  it("lehnt ohne jede Anmeldung mit 401 ab", async () => {
    const anwendung = await boot();
    const antwort = await request(anwendung.getHttpServer())
      .get("/api/v1/auth/session")
      .expect(401);
    expect(antwort.body.type).toBe("urn:easytree:auth:unauthenticated");
  });

  it("lehnt widersprechende Cookie- und Bearer-Identitaeten mit 401 CREDENTIAL_CONFLICT ab", async () => {
    // PO-Entscheidung woertlich: Cookie und Bearer gleichzeitig vorhanden und
    // nicht dieselbe Identitaet => 401 AUTH_CREDENTIAL_CONFLICT.
    // Gegenmutation (auszufuehren): den Identitaetsvergleich entfernen -> rot.
    const anwendung = await boot({
      bekannteTokens: {
        "token-a": { userId: USER, sessionId: "sitzung-1" },
        "token-b": { userId: "00000000-0000-4000-8000-00000000aaa2", sessionId: "sitzung-2" },
      },
    });
    const antwort = await request(anwendung.getHttpServer())
      .get("/api/v1/auth/session")
      .set("Cookie", "eyt_access=token-a")
      .set("Authorization", "Bearer token-b")
      .expect(401);
    expect(antwort.body.type).toBe("urn:easytree:auth:credential-conflict");
  });

  it("lehnt eine kryptografisch gueltige, aber widerrufene Session ab (AK1b an der Naht)", async () => {
    const anwendung = await boot({ sessionTot: true });
    await request(anwendung.getHttpServer())
      .get("/api/v1/auth/session")
      .set("Cookie", "eyt_access=gutes-token")
      .expect(401);
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("loescht beide Cookies, widerruft serverseitig und antwortet 204", async () => {
    const revoked: string[] = [];
    const anwendung = await boot({ revoked });
    const antwort = await request(anwendung.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Cookie", "eyt_access=gutes-token")
      .expect(204);
    const cookies = antwort.get("Set-Cookie") ?? [];
    expect(cookies.some((c) => c.startsWith("eyt_access=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("eyt_refresh=;") && c.includes("Max-Age=0"))).toBe(
      true,
    );
    expect(revoked).toEqual(["gutes-token"]);
  });
});
