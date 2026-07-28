/**
 * Der Produktionsstand des Mandantensubjekts ist geschlossen (EYT-50).
 *
 * Kein Verhaltenstest einer Route — die gibt es noch nicht. Geprueft wird die
 * SICHERHEITSEIGENSCHAFT der Naht: solange es keine Tokenpruefung gibt, liefert
 * der Produktionsstand kein Subjekt, und im DI-Graphen steckt nichts anderes.
 *
 * Der Test muss rot werden, wenn jemand den Default gegen etwas Nachgiebiges
 * tauscht — etwa "nimm den Header, wenn er da ist". Genau das ist die Aenderung,
 * die man beim Bau der ersten Route versucht ist zu machen.
 */
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import {
  TENANT_SUBJECT_RESOLVER,
  UnauthenticatedSubjectResolver,
  type TenantSubjectResolver,
} from "../src/common/tenant-subject";
import { DATABASE_PING, type DatabasePing } from "../src/health/readiness";

describe("Mandantensubjekt (EYT-50)", () => {
  it("liefert ohne Tokenpruefung kein Subjekt", () => {
    const resolver = new UnauthenticatedSubjectResolver();
    // Auch mit einem Request, der wie ein angemeldeter aussieht.
    expect(
      resolver.resolve({
        headers: {
          authorization: "Bearer beliebig",
          "x-easytree-subject": "00000000-0000-4000-8000-00000000aaa1",
        },
      }),
    ).toBeNull();
  });

  it("steckt genau dieser Stand im DI-Graphen", async () => {
    // Die eigentliche Aussage: nicht "es GIBT eine geschlossene Klasse",
    // sondern "die Anwendung benutzt sie". Ohne diese Zeile koennte jemand
    // eine nachgiebige Implementierung registrieren und der Test oben bliebe
    // gruen.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_PING)
      .useValue({ ping: (): Promise<boolean> => Promise.resolve(true) } satisfies DatabasePing)
      .compile();

    const resolver = moduleRef.get<TenantSubjectResolver>(TENANT_SUBJECT_RESOLVER);
    expect(resolver).toBeInstanceOf(UnauthenticatedSubjectResolver);
    expect(resolver.resolve({ headers: { authorization: "Bearer beliebig" } })).toBeNull();

    await moduleRef.close();
  });
});
