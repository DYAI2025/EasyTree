/**
 * Konflikte der Satzverwaltung als RFC-7807 mit stabilem URN (EYT-108).
 *
 * Eigener Filter statt `HttpException` mit Statuscode 409, weil die UI am
 * `type` unterscheidet, ob sie "Ueberlappung" oder "konkurrierende Aenderung"
 * anzeigt — und ein deutscher Meldungstext ist Darstellung, keine
 * Schnittstelle (dieselbe Begruendung wie bei `PLANNING_ERROR_TYPE`).
 *
 * ## Warum es seit EYT-139 einen zweiten Zweig gibt
 *
 * Gemessen, nicht vermutet: `HttpExceptionFilter` setzt `type` hart auf
 * `"about:blank"` und liest aus einer `HttpException` ausschliesslich `detail`.
 * Ein `throw new BadRequestException({ type: … })` verliert seinen URN also auf
 * dem Weg nach draussen — dieser Filter ist der EINZIGE Pfad, auf dem ein
 * stabiler URN das Modul verlaesst. Der Snapshot-Pfad braucht das nicht nur bei
 * 409: „Anzeigename fehlt" ist 400, „kein Kostenzugriff" 403, „falscher
 * Schreibkanal" 500. `CostsProblem` bringt Status und Titel deshalb selbst mit.
 *
 * Der `ConflictProblem`-Zweig bleibt in Wert und Form unveraendert. Er ist die
 * Regression der EYT-108-Satzrouten: 409 und „Konflikt" sind dort Vorbelegung,
 * nicht Ableitung, und ein Umbau, der beides aus der Ausnahme zoege, aenderte
 * ihr Verhalten still (`test/costs/costs-problem-filter.test.ts`, Fall 1).
 *
 * ## Warum der Rumpf als `ProblemDocument` annotiert ist
 *
 * `ProblemDocumentSchema` (`packages/contracts/src/primitives.ts`) ist ein
 * `z.strictObject`, und `readProblem` verwirft bei einem Fehlschlag das GANZE
 * Fehlerdokument, nicht bloss das ueberzaehlige Feld — ein sechstes Feld hier
 * kostet den Client also die ganze Meldung. Ohne die Annotation liess `tsc` ein
 * solches Feld durch (gemessen), und aufgefallen waere es erst am Test. Wo zwei
 * Riegel moeglich sind, sollen zwei greifen: der Compiler haelt die Form, der
 * Test die Werte. Gleiche Bauart wie in `common/http-exception.filter.ts`.
 */
import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";

import type { RequestWithCorrelationId } from "../../../../common/correlation-id.middleware";
import type { ProblemDocument } from "../../../../common/http-exception.filter";
import { ConflictProblem } from "./conflict-problem";
import { CostsProblem } from "./costs-problem";

@Catch(ConflictProblem, CostsProblem)
export class CostsProblemFilter implements ExceptionFilter {
  catch(exception: ConflictProblem | CostsProblem, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status = exception instanceof CostsProblem ? exception.status : HttpStatus.CONFLICT;
    const title = exception instanceof CostsProblem ? exception.title : "Konflikt";

    const body: ProblemDocument = {
      type: exception.type,
      title,
      status,
      detail: exception.message,
      correlationId: (req as Partial<RequestWithCorrelationId>).correlationId ?? "unknown",
    };

    res.status(status).json(body);
  }
}
