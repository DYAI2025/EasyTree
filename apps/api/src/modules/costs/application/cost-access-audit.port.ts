/**
 * Nachvollziehbarkeit jeder Kosten-Zugriffsentscheidung (EYT-106 AK9, EYT-135).
 *
 * ## Was ein Auditereignis hier ist
 *
 * Eine Zeile pro ENTSCHEIDUNG — nicht pro Anfrage, nicht pro Fehler. Erlaubte
 * und abgelehnte Zugriffe sind gleich wichtig: ein Audit, das nur Ablehnungen
 * kennt, beantwortet die eigentliche Frage nicht ("wer hat die Saetze
 * gesehen?").
 *
 * ## Warum die Feldliste eingefroren ist
 *
 * `serialisiereZugriffsereignis` baut das JSON aus {@link
 * COST_ACCESS_EVENT_FIELDS} — nicht aus dem uebergebenen Objekt. Der
 * Unterschied ist der ganze Datenschutz: `JSON.stringify(event)` schriebe jedes
 * Feld hinaus, das irgendwann jemand anheftet, und TypeScript sieht das nicht,
 * weil ein Objekt mit Zusatzfeldern strukturell weiterhin zuweisbar ist.
 * Verboten sind ausdruecklich Token, Cookieinhalte, Passwoerter,
 * Service-Role-Geheimnisse, Mitarbeitername, Stundensatz, Kostenbetrag,
 * vollstaendige Request-Bodies und sensible Header.
 *
 * ## Der Logger entscheidet nicht
 *
 * Dieses Modul beobachtet die Entscheidung der {@link CostAccessPolicy}. Es
 * bildet keine zweite Policy Engine, und ein Fehler beim Protokollieren darf
 * eine Entscheidung nicht veraendern — der Aufrufer faengt deshalb ab (siehe
 * `CostsController`). Das ist bewusst NICHT fail-closed: ein kaputter Logger
 * wuerde sonst jeden Kostenzugriff sperren, also einen selbstverschuldeten
 * Ausfall erzeugen. Der Verlust einer Auditzeile ist das kleinere Uebel und
 * hier ausdruecklich benannt statt versehentlich in Kauf genommen.
 */
import { createHash } from "node:crypto";

import type { CostPermission } from "./cost-access.policy";

/** Der eine Ereignisname. Log-Auswertungen greifen darauf zu. */
export const COST_ACCESS_DECISION_EVENT = "cost_access_decision";

/**
 * Stabile Ablehnungsgruende.
 *
 * Die drei letzten sind woertlich die `CostAccessProblem`-Werte der Policy;
 * `UNAUTHENTICATED` kommt hinzu, weil eine Anfrage ohne gueltige Identitaet
 * die Policy nie erreicht — und trotzdem eine Zugriffsentscheidung ueber eine
 * Kostenressource ist. Ohne diesen Wert haette das Audit ein Loch genau dort,
 * wo ein Angriff sichtbar wuerde.
 */
export const COST_ACCESS_DENY_REASONS = [
  "UNAUTHENTICATED",
  "ORG_CONTEXT_REQUIRED",
  "ORG_NOT_A_MEMBER",
  "PERMISSION_MISSING",
] as const;
export type CostAccessDenyReason = (typeof COST_ACCESS_DENY_REASONS)[number];

export interface CostAccessDecisionEvent {
  readonly event: typeof COST_ACCESS_DECISION_EVENT;
  /** Verbindet die Zeile mit HTTP-Antwort und Problem-Dokument. */
  readonly correlationId: string;
  readonly decision: "allow" | "deny";
  /** Das ANGEFRAGTE atomare Recht, nicht die Rolle. */
  readonly permission: CostPermission;
  /** Nur wenn serverseitig bestaetigt; sonst null. Nie der rohe Header. */
  readonly organisationId: string | null;
  /** Pseudonym aus {@link pseudonymSubjekt}; nie die rohe Nutzer-Id. */
  readonly subject: string | null;
  readonly reason: CostAccessDenyReason | null;
  /** ISO-8601-Instant in UTC. */
  readonly at: string;
  /** Route beziehungsweise Anwendungsfall, z. B. `GET /kosten/mitarbeiter`. */
  readonly route: string;
}

/**
 * Die vollstaendige, erlaubte Feldliste. Was hier nicht steht, verlaesst den
 * Prozess nicht. Eine Erweiterung ist eine Datenschutzentscheidung und faellt
 * dem Test `cost-access-audit.test.ts` auf.
 */
export const COST_ACCESS_EVENT_FIELDS = [
  "event",
  "correlationId",
  "decision",
  "permission",
  "organisationId",
  "subject",
  "reason",
  "at",
  "route",
] as const satisfies readonly (keyof CostAccessDecisionEvent)[];

/**
 * Pseudonym der handelnden Person.
 *
 * SHA-256 ueber die Nutzer-Id, auf 64 Bit gekuerzt. Ohne Schluessel, und das
 * ist hier vertretbar: Supabase-Nutzer-Ids sind UUIDs v4 mit 122 zufaelligen
 * Bit — ein Rueckschluss aus dem Hash setzte das Durchprobieren dieses Raums
 * voraus. Fuer eine E-Mail-Adresse gaelte das NICHT; wer dieses Verfahren
 * jemals auf einen aufzaehlbaren Wertebereich anwendet, braucht einen
 * geheimen Schluessel (HMAC).
 *
 * Bewusst deterministisch: ein Audit muss die Entscheidungen EINER Person
 * ueber die Zeit zusammenfuehren koennen, ohne zu wissen, wer sie ist. Ein
 * Zufallswert je Anfrage waere datenschutzfreundlicher und als Audit wertlos.
 */
export function pseudonymSubjekt(userId: string): string {
  return `subj_${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`;
}

/**
 * Baut die Logzeile ausschliesslich aus {@link COST_ACCESS_EVENT_FIELDS}.
 * Angeheftete Fremdfelder fallen dabei heraus — das ist der Zweck, nicht ein
 * Nebeneffekt.
 */
export function serialisiereZugriffsereignis(event: CostAccessDecisionEvent): string {
  const gefiltert: Record<string, unknown> = {};
  for (const feld of COST_ACCESS_EVENT_FIELDS) {
    gefiltert[feld] = event[feld];
  }
  return JSON.stringify(gefiltert);
}

export interface CostAccessAuditLog {
  /**
   * Nimmt die Entscheidung entgegen. Rueckgabewert `void` mit Absicht: der
   * Aufrufer darf aus dem Protokollieren nichts ableiten.
   */
  record(event: CostAccessDecisionEvent): void;
}

export const COST_ACCESS_AUDIT = "COSTS_ACCESS_AUDIT";
