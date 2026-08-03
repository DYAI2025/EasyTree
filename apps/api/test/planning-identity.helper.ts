/**
 * DI-Ersetzung der Planungs-Identitaet fuer HTTP-Tests (EYT-107).
 *
 * Keine Suite — ein Helfer. Dateien unter `test/` ohne `.test.ts` werden von
 * vitest nicht eingesammelt (siehe `tenant-context.helper.ts`).
 *
 * ## Warum hier zwei Tokens ersetzt werden und nicht einer
 *
 * Seit EYT-107 haengt die Planung an derselben Kette wie die Kosten:
 * `REQUEST_IDENTITY` beantwortet „wer", `SESSION_ORGANISATIONS` beantwortet
 * „wo und mit welchen Rechten". Beide brauchen im Unittest eine Vorgabe, weil
 * sonst ein echter Auth-Server und eine echte Datenbank noetig waeren.
 *
 * Die POLICY wird ausdruecklich NICHT ersetzt. Sie ist der Teil, der geprueft
 * werden soll: ob aus „owner mit diesen Rechten" ein Ja oder Nein wird,
 * entscheidet `MembershipPlanningAccessPolicy` selbst. Eine gestellte Policy
 * haette in jedem dieser Tests die Antwort vorgegeben, die sie beweisen
 * sollen — genau die Sorte Test, die nichts misst.
 */
import type { TestingModuleBuilder } from "@nestjs/testing";

import { PLANNING_PERMISSIONS } from "../src/modules/planning";
// `IdentityRejectedError` wird ECHT importiert, nicht nachgebaut: der
// AuthProblemFilter erkennt ihn per `instanceof`, und eine eigene Klasse
// gleichen Namens liefe dort in den generischen Zweig.
import { IdentityRejectedError, REQUEST_IDENTITY } from "../src/platform/auth/request-identity";
import { SESSION_ORGANISATIONS } from "../src/modules/tenancy";

export const TEST_SUBJECT = "00000000-0000-4000-8000-00000000aaa1";
export const TEST_ORG = "00000000-0000-4000-8000-0000000000a1";
export const TEST_ORG_B = "00000000-0000-4000-8000-0000000000b2";

export interface IdentitaetsVorgabe {
  /** `null` bedeutet: keine gueltige Identitaet, `identify` wirft. */
  readonly subject?: string | null;
  /** Rechte der EINEN Mitgliedschaft. Vorgabe: alle drei Planungsrechte. */
  readonly permissions?: readonly string[];
  /** Mehr als eine Mitgliedschaft erzwingt `ORG_CONTEXT_REQUIRED`. */
  readonly organisationen?: readonly { organisationId: string; permissions: readonly string[] }[];
}

/** Haengt die beiden Identitaetstokens an einen Testing-Module-Builder. */
export function mitPlanungsIdentitaet(
  builder: TestingModuleBuilder,
  vorgabe: IdentitaetsVorgabe = {},
): TestingModuleBuilder {
  const subject = vorgabe.subject === undefined ? TEST_SUBJECT : vorgabe.subject;
  const organisationen =
    vorgabe.organisationen ??
    (subject === null
      ? []
      : [
          {
            organisationId: TEST_ORG,
            permissions: vorgabe.permissions ?? [...PLANNING_PERMISSIONS],
          },
        ]);

  return builder
    .overrideProvider(REQUEST_IDENTITY)
    .useValue({
      identify: (): Promise<{ userId: string; sessionId: string }> => {
        if (subject === null) {
          // Derselbe Fehlertyp wie in Produktion: der AuthProblemFilter
          // erkennt ihn per `instanceof` und macht daraus 401 mit stabilem URN.
          return Promise.reject(new IdentityRejectedError("MISSING"));
        }
        return Promise.resolve({ userId: subject, sessionId: "test-session" });
      },
    })
    .overrideProvider(SESSION_ORGANISATIONS)
    .useValue({
      organisationsFor: (): Promise<
        readonly {
          organisationId: string;
          organisationName: string;
          role: string;
          permissions: readonly string[];
        }[]
      > =>
        Promise.resolve(
          organisationen.map((eintrag) => ({
            organisationId: eintrag.organisationId,
            organisationName: `Organisation ${eintrag.organisationId.slice(-2)}`,
            role: "owner",
            permissions: eintrag.permissions,
          })),
        ),
    });
}
