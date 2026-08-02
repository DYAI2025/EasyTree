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
import type { PlanCostFactsProblem } from "../../application/plan-cost-facts.port";

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
} as const;

export type RateErrorType = (typeof RATE_ERROR_TYPE)[keyof typeof RATE_ERROR_TYPE];
