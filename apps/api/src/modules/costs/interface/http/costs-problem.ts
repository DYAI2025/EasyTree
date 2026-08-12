/**
 * Eine fachliche Ablehnung des Kostenpfades mit stabilem URN UND eigenem
 * Statuscode (EYT-139).
 *
 * ## Warum es diese Klasse zusaetzlich zu `ConflictProblem` gibt
 *
 * Gemessen, nicht vermutet: `HttpExceptionFilter` setzt `type` hart auf
 * `"about:blank"` und liest aus einer `HttpException` ausschliesslich `detail`.
 * Ein `throw new BadRequestException({ type: … })` verliert seinen URN also auf
 * dem Weg nach draussen. Der einzige Pfad, der heute einen URN durchreicht, ist
 * `ConflictProblem` -> `CostsProblemFilter`. Der Snapshot-Pfad braucht stabile
 * URNs auch bei 400, 403 und 500 — deshalb diese Klasse.
 *
 * ## Warum `ConflictProblem` NICHT erweitert wird
 *
 * Weil eine „ConflictProblem" mit Status 400 im Namen luegen wuerde. Das ist
 * das ganze Argument — und bewusst nur dieses: eine fruehere Fassung behauptete
 * hier zusaetzlich, jede Aenderung an `ConflictProblem` veraenderte das
 * Verhalten der EYT-108-Satzrouten mit. Gemessen ist das falsch,
 * `ConflictProblem extends CostsProblem` mit `{status: 409, title: "Konflikt"}`
 * kompiliert und laesst 189 Tests gruen. Eine zu starke Begruendung ist auch
 * eine falsche, also steht hier nur die tragfaehige. Zwei Klassen, ein Filter:
 * das Bestehende bleibt Byte fuer Byte, das Neue bekommt seinen eigenen Weg.
 *
 * ## Dass die Abbildung auf der Ausnahme liegt, ist ein DRITTES Muster
 *
 * `AuthProblemFilter` haelt seine HTTP-Abbildung im Filter — eine Tabelle
 * Ausnahmeklasse -> Problem, in der jeder Status eine `HttpStatus.*`-Konstante
 * an genau einer Stelle ist. `CostsProblem` dreht das um und legt den Status
 * auf die Ausnahme. Das ist gewollt (die Wahl trifft, wer die Ablehnung kennt),
 * erkauft aber genau die Gefahr, gegen die {@link CostsProblemStatus} steht: im
 * Auth-Entwurf kann eine Aufrufstelle gar keinen Status erfinden, hier schon.
 *
 * ## Warum ein Objekt und keine vier Positionsparameter
 *
 * `title`, `type` und `detail` sind alle `string`. Drei gleichtypige
 * Positionsparameter lassen sich vertauschen, ohne dass irgendetwas auffaellt —
 * der Compiler schweigt, und die Antwort traegt dann den URN im Titel. Das ist
 * dieselbe Begruendung, mit der `PublishedPlanVersionsQuerySchema` einen
 * Wochenbereich als Objekt statt als zwei nackte Strings fuehrt. Benannte
 * Felder machen die Vertauschung unmoeglich statt bloss unwahrscheinlich.
 */
/**
 * Die Statuscodes, die der Kostenpfad ueberhaupt aussprechen darf.
 *
 * Eine Union und kein `number`: gemessen kompiliert `status: 200`, und eine
 * 200 nimmt im Client den ERFOLGSPFAD — `readProblem` laeuft nur innerhalb von
 * `if (!response.ok)` (`http/costs-gateway.ts`). Die Ablehnung kaeme dann als
 * `CONTRACT_VIOLATION` mit `problem: null` an, ohne URN und ohne Text. Ein
 * ungueltiger Code wie 42 ist noch schlimmer: `res.status(42)` wirft
 * `ERR_HTTP_INVALID_STATUS_CODE` INNERHALB des Filters, wo nichts mehr faengt.
 *
 * Warum genau diese vier: `problemResponses` fuehrt 400, 403 und 409; 500 ist
 * die dokumentierte Entscheidung fuer `WRITE_CHANNEL_REJECTED` und fuer ein
 * fehlgeschlagenes Ruecklesen. 401 fehlt bewusst — das spricht
 * `AuthProblemFilter`, nicht diese Klasse. 404 und 422 fehlen, weil der Vertrag
 * sie in KEINER seiner 18 Operationen fuehrt; sie hier zuzulassen waere eine
 * Einladung, sie zu benutzen.
 *
 * Der API-lokale `ProblemDocument` reicht dafuer nicht: sein `status` ist ein
 * blankes `number`, waehrend `ProblemDocumentSchema` `int 400..599` verlangt.
 * Die Annotation im Filter haelt die FORM des Rumpfes, diese Union den WERT.
 */
export type CostsProblemStatus = 400 | 403 | 409 | 500;

export interface CostsProblemInput {
  readonly status: CostsProblemStatus;
  readonly title: string;
  readonly type: string;
  readonly detail: string;
}

export class CostsProblem extends Error {
  readonly status: CostsProblemStatus;
  readonly title: string;
  readonly type: string;

  constructor(input: CostsProblemInput) {
    super(input.detail);
    this.name = "CostsProblem";
    this.status = input.status;
    this.title = input.title;
    this.type = input.type;
  }
}
