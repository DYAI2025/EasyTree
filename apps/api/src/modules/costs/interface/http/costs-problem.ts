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
 * Weil eine „ConflictProblem" mit Status 400 im Namen luegen wuerde, und weil
 * jede Aenderung daran das Verhalten der EYT-108-Satzrouten mitveraenderte.
 * Zwei Klassen, ein Filter: das Bestehende bleibt Byte fuer Byte, das Neue
 * bekommt seinen eigenen Weg.
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
export interface CostsProblemInput {
  readonly status: number;
  readonly title: string;
  readonly type: string;
  readonly detail: string;
}

export class CostsProblem extends Error {
  readonly status: number;
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
