/**
 * Auditsenke fuer Kosten-Zugriffsentscheidungen (EYT-106 AK9, EYT-135).
 *
 * Eine Zeile JSON auf den Nest-Logger. Bewusst keine eigene Datei, kein
 * eigener Transport, keine Tabelle: die Betriebsumgebung sammelt stdout
 * ohnehin ein, und ein zweiter Auslieferungsweg waere ein zweiter Ort, an dem
 * Auditzeilen verloren gehen koennen.
 *
 * Die Zeile entsteht in `serialisiereZugriffsereignis` — dort und nur dort
 * liegt die Feldliste. Dieser Adapter darf sie nicht anreichern; taete er es,
 * waere die Datenschutzzusage an einer Stelle formuliert und an einer anderen
 * gebrochen.
 */
import { Injectable, Logger } from "@nestjs/common";

import {
  serialisiereZugriffsereignis,
  type CostAccessAuditLog,
  type CostAccessDecisionEvent,
} from "../application/cost-access-audit.port";

@Injectable()
export class NestCostAccessAuditLog implements CostAccessAuditLog {
  readonly #logger = new Logger("CostAccess");

  record(event: CostAccessDecisionEvent): void {
    // `log`, nicht `warn` — auch eine Ablehnung ist der Normalbetrieb einer
    // funktionierenden Zugangskontrolle und kein Betriebsproblem.
    this.#logger.log(serialisiereZugriffsereignis(event));
  }
}
