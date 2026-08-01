/**
 * AK1 — fail-closed Tokenverifikation (EYT-106).
 *
 * Jede Ablehnungsform ist ein EIGENER Fall mit eigenem Titel — nicht als
 * Schleife unter einer Assertion. Grund liegt im Plan (§AK1): unbenannte
 * Sammelzusicherungen konnten frueher nicht sagen, welcher Wert durchrutschte.
 *
 * Schluessel und Tokens entstehen im Test; kein Stack noetig. Die Schluessel-
 * quelle ist injiziert (lokales JWKS), die Pruefregeln sind es nicht — genau
 * die Grenze, die auch die Produktion hat (dort: Remote-JWKS von GoTrue).
 */
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  JoseTokenVerifier,
  TokenRejectedError,
  type TokenRejection,
} from "../../src/platform/auth/token-verifier";

const ISSUER = "http://127.0.0.1:54321/auth/v1";
const AUDIENCE = "authenticated";
const KID = "test-schluessel-1";

let verifier: JoseTokenVerifier;
let signKey: CryptoKey;
let fremdKey: CryptoKey;
let hmacSecret: Uint8Array;

beforeAll(async () => {
  const paar = await generateKeyPair("ES256");
  signKey = paar.privateKey as CryptoKey;
  const fremd = await generateKeyPair("ES256");
  fremdKey = fremd.privateKey as CryptoKey;
  hmacSecret = new TextEncoder().encode("nur-fuer-den-alg-confusion-fall-123456");

  const jwk = await exportJWK(paar.publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: "ES256", use: "sig" }] });
  verifier = new JoseTokenVerifier({ getKey: jwks, issuer: ISSUER, audience: AUDIENCE });
});

interface TokenForm {
  issuer?: string;
  audience?: string;
  expiresIn?: string;
  sub?: string | undefined;
  sessionId?: string | undefined;
  kid?: string;
  key?: CryptoKey;
}

async function es256Token(form: TokenForm = {}): Promise<string> {
  const jwt = new SignJWT({
    ...(form.sessionId === undefined && !("sessionId" in form)
      ? { session_id: "sitzung-1" }
      : form.sessionId !== undefined
        ? { session_id: form.sessionId }
        : {}),
  })
    .setProtectedHeader({ alg: "ES256", kid: form.kid ?? KID })
    .setIssuedAt()
    .setIssuer(form.issuer ?? ISSUER)
    .setAudience(form.audience ?? AUDIENCE)
    .setExpirationTime(form.expiresIn ?? "5m");
  if (form.sub !== undefined || !("sub" in form)) jwt.setSubject(form.sub ?? "user-1");
  return jwt.sign(form.key ?? signKey);
}

async function erwarteAblehnung(token: string, code: TokenRejection): Promise<void> {
  try {
    await verifier.verify(token);
    expect.unreachable(`Token haette mit ${code} abgelehnt werden muessen`);
  } catch (fehler) {
    expect(fehler).toBeInstanceOf(TokenRejectedError);
    expect((fehler as TokenRejectedError).code).toBe(code);
    // AK9-Vorgriff, hier schon festgehalten: kein Tokenmaterial in der Meldung.
    expect((fehler as Error).message).not.toContain(token.slice(0, 16));
  }
}

describe("JoseTokenVerifier — Annahme", () => {
  it("akzeptiert ein gueltiges ES256-Token und liefert userId und sessionId", async () => {
    // Gegenmutation: issuer-Pruefung gegen einen anderen Wert stellen -> rot.
    const identitaet = await verifier.verify(await es256Token());
    expect(identitaet).toEqual({ userId: "user-1", sessionId: "sitzung-1" });
  });
});

describe("JoseTokenVerifier — die Ablehnungsformen, je ein eigener Fall", () => {
  it("lehnt eine manipulierte Signatur ab (SIGNATURE_INVALID)", async () => {
    const token = await es256Token();
    const teile = token.split(".");
    const signatur = teile[2] ?? "";
    // Letzte Zeichen kippen — Header und Claims bleiben unveraendert gueltig.
    const gekippt = signatur.slice(0, -4) + (signatur.endsWith("AAAA") ? "BBBB" : "AAAA");
    await erwarteAblehnung(`${teile[0]}.${teile[1]}.${gekippt}`, "SIGNATURE_INVALID");
  });

  it("lehnt einen falschen Issuer ab (ISSUER_MISMATCH)", async () => {
    await erwarteAblehnung(
      await es256Token({ issuer: "https://angreifer.example/auth/v1" }),
      "ISSUER_MISMATCH",
    );
  });

  it("lehnt eine falsche Audience ab (AUDIENCE_MISMATCH)", async () => {
    await erwarteAblehnung(await es256Token({ audience: "service_role" }), "AUDIENCE_MISMATCH");
  });

  it("lehnt ein abgelaufenes Token ab (EXPIRED)", async () => {
    await erwarteAblehnung(await es256Token({ expiresIn: "-5m" }), "EXPIRED");
  });

  it("lehnt ein Token ohne Subject ab (SUBJECT_MISSING)", async () => {
    await erwarteAblehnung(await es256Token({ sub: undefined }), "SUBJECT_MISSING");
  });

  it("lehnt ein HS256-Token ab, VOR jeder Schluesselsuche (ALGORITHM_NOT_ALLOWED)", async () => {
    // Alg-Confusion: die klassische Verwechslung. Der Code muss
    // ALGORITHM_NOT_ALLOWED sein, nicht KEY_UNKNOWN — die Allowlist
    // entscheidet, bevor irgendein Schluessel angefasst wird.
    // Gegenmutation (auszufuehren): `algorithms: ["ES256"]` aus der
    // Verifikation entfernen -> dieser Fall meldet KEY_UNKNOWN statt
    // ALGORITHM_NOT_ALLOWED -> rot.
    const hs256 = await new SignJWT({ session_id: "sitzung-1" })
      .setProtectedHeader({ alg: "HS256", kid: KID })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("user-1")
      .setExpirationTime("5m")
      .sign(hmacSecret);
    await erwarteAblehnung(hs256, "ALGORITHM_NOT_ALLOWED");
  });

  it("lehnt ein unbekanntes kid ab (KEY_UNKNOWN)", async () => {
    await erwarteAblehnung(
      await es256Token({ kid: "fremder-schluessel", key: fremdKey }),
      "KEY_UNKNOWN",
    );
  });

  it("lehnt alg=none ab (ALGORITHM_NOT_ALLOWED)", async () => {
    // Von Hand gebaut — jose signiert so etwas zu Recht nicht.
    const b64 = (obj: object): string => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const kopf = b64({ alg: "none", typ: "JWT" });
    const claims = b64({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "user-1",
      session_id: "sitzung-1",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    await erwarteAblehnung(`${kopf}.${claims}.`, "ALGORITHM_NOT_ALLOWED");
  });

  it("lehnt ein Token ohne session_id ab (SESSION_MISSING)", async () => {
    await erwarteAblehnung(await es256Token({ sessionId: undefined }), "SESSION_MISSING");
  });

  it("lehnt Muell ab, der kein JWT ist (MALFORMED)", async () => {
    await erwarteAblehnung("das.ist.kein-token", "MALFORMED");
  });
});
