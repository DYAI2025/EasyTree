/**
 * API-Server fuer den integrierten Read-Through-Nachweis (EYT-50).
 *
 * Kein `.test.ts`-Suffix: bewusst Werkzeug, keine Suite.
 *
 * ## Was ersetzt wird — und was ausdruecklich nicht
 *
 * ERSETZT werden genau zwei Dinge, und beide nur, weil es sie im
 * Produktionsstand noch nicht gibt:
 *   - `TENANT_SUBJECT_RESOLVER` — die Tokenpruefung gehoert zu EYT-14;
 *   - `PLANNING_ACCESS_POLICY`  — das Rollenmodell ebenso.
 *
 * NICHT ersetzt werden: die Query-Fabrik, das Repository, der
 * `TenantQueryRunner`, der Verbindungspool, die Controller, der
 * Exception-Filter. Wuerde eines davon ausgetauscht, pruefte der Harness
 * seine eigene Nachbildung — und genau das ist der Fehler, der in dieser
 * Arbeit schon mehrfach in Tests steckte.
 *
 * ## Warum das hier liegt und nicht in `src/`
 *
 * Damit im Produktionspfad kein Schalter entsteht. Ein "nur in test aktiver"
 * Bypass in `main.ts` waere die naheliegende Alternative und genau das
 * Konstrukt, das irgendwann in einer Produktionskonfiguration landet.
 * Dieselbe Trennung wie beim Rollenleser: `main.ts` hat einen
 * Einspritzpunkt, keine Umgehung.
 */
import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AppModule } from "../../src/app.module";
import { API_BASE_PATH } from "../../src/common/api-base-path";
import {
  TENANT_SUBJECT_RESOLVER,
  type TenantSubjectResolver,
} from "../../src/common/tenant-subject";
import { PLANNING_ACCESS_POLICY, type PlanningAccessPolicy } from "../../src/modules/planning";

export interface HarnessOptions {
  /** Die EINE Identitaet, unter der dieser Server arbeitet. */
  readonly subjectUserId: string;
  readonly port: number;
}

/**
 * Startet die ECHTE Anwendung unter einer festen Identitaet.
 *
 * Das Subjekt ist an den Serverstart gebunden, nicht an die Anfrage: kein
 * Header, kein Cookie, keine Query und keine Umgebungsvariable waehlen es aus.
 * Wer eine zweite Identitaet braucht, startet einen zweiten Server.
 */
export async function startHarnessApi(options: HarnessOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TENANT_SUBJECT_RESOLVER)
    .useValue({
      // Die Anfrage wird bewusst nicht angesehen — sonst waere das Subjekt
      // doch wieder aus ihr waehlbar.
      resolve: (): string => options.subjectUserId,
    } satisfies TenantSubjectResolver)
    .overrideProvider(PLANNING_ACCESS_POLICY)
    .useValue({
      mayReadPlanning: (): Promise<boolean> => Promise.resolve(true),
      mayWritePlanning: (): Promise<boolean> => Promise.resolve(true),
    } satisfies PlanningAccessPolicy)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix(API_BASE_PATH, { exclude: ["health", "ready"] });
  app.enableShutdownHooks();
  await app.listen(options.port);
  return app;
}
