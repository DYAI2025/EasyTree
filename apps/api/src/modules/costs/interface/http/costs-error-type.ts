/**
 * Stabile Fehlercodes der Kosten-HTTP-Naht (EYT-105, REQ-001, ADR-003).
 *
 * ## Warum der Code zuerst kommt und der Controller spaeter
 *
 * Der Fehlercode ist Vertrag, der Controller ist Verdrahtung. Ein Client, der
 * „nicht veroeffentlicht" von „keine Organisation" unterscheiden will, muesste
 * ohne diese Codes den deutschen Meldungstext parsen — und der ist Darstellung,
 * keine Schnittstelle (gleiche Begruendung wie `PLANNING_ERROR_TYPE`).
 *
 * Die Route selbst entsteht mit EYT-109, ihre Autorisierung mit EYT-106. Sie
 * hier vorwegzunehmen hiesse, einen Endpunkt ohne Rechtepruefung zu
 * veroeffentlichen; ausserdem meldete `openapi-route-conformance.test.ts` ihn
 * zu Recht als undokumentierten Endpunkt, solange der Vertrag keine passende
 * Operation fuehrt.
 *
 * ## Warum URN und nicht HTTP-URL
 *
 * Ein Link muesste aufloesbar sein; eine Dokumentseite, die es nicht gibt, ist
 * ein gebrochenes Versprechen im Fehlerobjekt.
 *
 * Diese Werte sind Teil des Vertrags. Sie umzubenennen ist eine
 * Vertragsaenderung, kein Refactoring.
 */
import type {
  SnapshotReadProblem,
  SnapshotWriteProblem,
} from "../../application/cost-snapshot-repository.port";
import type { PlanCostFactsProblem } from "../../application/plan-cost-facts.port";
import type { SnapshotAssemblyProblem } from "../../domain/cost-snapshot-assembly";

/**
 * Genau ein Code je Ablehnungsgrund des Faktenports.
 *
 * `satisfies` statt Typannotation: die Annotation wuerde die Literaltypen
 * verschlucken, `satisfies` behaelt sie und erzwingt trotzdem
 * Vollstaendigkeit. Ein neuer Eintrag in `PLAN_COST_FACTS_PROBLEMS` ohne Code
 * hier kompiliert nicht — genau das soll er auch nicht.
 */
export const COSTS_ERROR_TYPE = {
  NO_ORGANISATION: "urn:easytree:costs:no-organisation",
  AMBIGUOUS_ORGANISATION: "urn:easytree:costs:ambiguous-organisation",
  PLAN_NOT_PUBLISHED: "urn:easytree:costs:plan-not-published",
  PLAN_VERSION_NOT_FOUND: "urn:easytree:costs:plan-version-not-found",
} as const satisfies Record<PlanCostFactsProblem, string>;

export type CostsErrorType = (typeof COSTS_ERROR_TYPE)[keyof typeof COSTS_ERROR_TYPE];

/**
 * Codes der Satzverwaltung (EYT-108).
 *
 * Bewusst eine ZWEITE Konstante statt zusaetzlicher Schluessel oben: das
 * `satisfies Record<PlanCostFactsProblem, string>` dort ist eine
 * Vollstaendigkeitszusicherung fuer GENAU die Faktenport-Probleme. Faende sich
 * ein fremder Schluessel darin, waere die Zusicherung keine mehr — sie wuerde
 * nicht mehr messen, ob jedes Faktenproblem einen Code hat.
 */
export const RATE_ERROR_TYPE = {
  RATE_NOT_FOUND: "urn:easytree:costs:rate-not-found",
  RATE_INTERVAL_OVERLAP: "urn:easytree:costs:rate-interval-overlap",
  RATE_AMBIGUOUS: "urn:easytree:costs:rate-ambiguous",
  STALE_VERSION: "urn:easytree:costs:stale-version",
  // EYT-108 Option A+: Ablehnungen der Abloesung. Eigene URNs, weil der
  // Aufrufer je Fall etwas ANDERES tun muss — neu laden, ein anderes Datum
  // waehlen, oder die Person korrigieren.
  RATE_PREDECESSOR_CLOSED: "urn:easytree:costs:rate-predecessor-closed",
  RATE_SUCCESSOR_NOT_LATER: "urn:easytree:costs:rate-successor-not-later",
  RATE_EMPLOYEE_MISMATCH: "urn:easytree:costs:rate-employee-mismatch",
  IDEMPOTENCY_KEY_REUSED: "urn:easytree:costs:idempotency-key-reused",
  MISSING_IDEMPOTENCY_KEY: "urn:easytree:costs:missing-idempotency-key",
} as const;

export type RateErrorType = (typeof RATE_ERROR_TYPE)[keyof typeof RATE_ERROR_TYPE];

/**
 * Genau ein Code je Montagegrund (EYT-139).
 *
 * Zwei Eintraege verweisen bewusst auf bestehende URNs aus `RATE_ERROR_TYPE`:
 * „Satz fehlt" und „Satz mehrdeutig" bedeuten hier dasselbe wie in der
 * Satzverwaltung. Ein zweiter URN fuer dieselbe Aussage waere ein neuer
 * Problemname, den kein Vertrag verlangt.
 */
export const SNAPSHOT_ASSEMBLY_ERROR_TYPE = {
  RATE_NOT_FOUND: RATE_ERROR_TYPE.RATE_NOT_FOUND,
  RATE_AMBIGUOUS: RATE_ERROR_TYPE.RATE_AMBIGUOUS,
  RATE_INVALID: "urn:easytree:costs:rate-invalid",
  LABEL_MISSING: "urn:easytree:costs:label-missing",
  DAY_BOUNDARY_NONEXISTENT: "urn:easytree:costs:day-boundary-nonexistent",
  DAY_BOUNDARY_AMBIGUOUS: "urn:easytree:costs:day-boundary-ambiguous",
  TIME_ZONE_UNKNOWN: "urn:easytree:costs:time-zone-unknown",
  INTERVAL_INVALID: "urn:easytree:costs:interval-invalid",
} as const satisfies Record<SnapshotAssemblyProblem, string>;

export type SnapshotAssemblyErrorType =
  (typeof SNAPSHOT_ASSEMBLY_ERROR_TYPE)[keyof typeof SNAPSHOT_ASSEMBLY_ERROR_TYPE];

/**
 * Genau ein Code je Schreibablehnung (EYT-139).
 *
 * `IDEMPOTENCY_KEY_REUSED` teilt seinen URN mit der Satzverwaltung: derselbe
 * Schluessel fuer eine andere Nutzlast heisst hier dasselbe wie dort, und ein
 * zweiter URN dafuer waere ein Problemname ohne Vertragsdeckung.
 *
 * `WRITE_CHANNEL_REJECTED` wird spaeter eine 500 und keine 401/403: der Port
 * schliesst die Umdeutung in einen Auth- oder Mandantenfehler ausdruecklich aus
 * — das Subjekt kann korrekt angemeldet und berechtigt sein und trotzdem ueber
 * den falschen Kanal (PostgREST, Transaktionspooler) kommen. Das ist ein
 * Betriebsfehler, kein Aufruferfehler, und ein 403 schickte die Betreiberin auf
 * die Suche nach einem Rechteproblem, das es nicht gibt.
 */
export const SNAPSHOT_WRITE_ERROR_TYPE = {
  IDEMPOTENCY_KEY_REUSED: RATE_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED,
  WORKSITE_NOT_IN_ORG: "urn:easytree:costs:worksite-not-in-org",
  WRITE_CHANNEL_REJECTED: "urn:easytree:costs:write-channel-rejected",
} as const satisfies Record<SnapshotWriteProblem, string>;

export type SnapshotWriteErrorType =
  (typeof SNAPSHOT_WRITE_ERROR_TYPE)[keyof typeof SNAPSHOT_WRITE_ERROR_TYPE];

/**
 * Ein Grund, ein Code — und das ist die Aussage.
 *
 * „gibt es nicht", „gehoert einem anderen Mandanten" und „das Subjekt darf
 * Kosten nicht sehen" fallen im Port bereits zu EINEM Grund zusammen. Dass es
 * hier genau einen URN gibt, ist die HTTP-Haelfte derselben Zusage: es gibt
 * keinen Weg, aus der Antwort auf die Existenz einer fremden Id zu schliessen.
 */
export const SNAPSHOT_READ_ERROR_TYPE = {
  SNAPSHOT_NOT_FOUND: "urn:easytree:costs:snapshot-not-found",
} as const satisfies Record<SnapshotReadProblem, string>;

export type SnapshotReadErrorType =
  (typeof SNAPSHOT_READ_ERROR_TYPE)[keyof typeof SNAPSHOT_READ_ERROR_TYPE];
