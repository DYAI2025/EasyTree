/**
 * Schreibport der Planung (EYT-92).
 *
 * Getrennt von {@link PlanningQueries}, weil die beiden verschiedene Fragen
 * beantworten und verschieden scheitern: eine Leseanfrage kann keinen Konflikt
 * erzeugen, eine Schreibanfrage keine Mehrdeutigkeit der Organisation
 * verschweigen.
 *
 * Wie beim Leseport steht die Organisation in KEINER Signatur. Sie kommt
 * ausschliesslich aus dem gesetzten Datenbankkontext (`app.user_org_ids()` ueber
 * RLS). Ein Parameter `orgId` waere die Einladung, ihn aus dem Request-Body zu
 * befuellen — und ein Body ist Clienteingabe.
 */

/** Angelegte Zuweisung, so wie sie in der Datenbank steht. */
export interface CreatedAssignmentRow {
  readonly id: string;
  readonly planVersionId: string;
  readonly employeeId: string;
  readonly worksiteId: string;
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date;
}

/** Eine kollidierende Zuweisung, benannt, damit die Meldung konkret werden kann. */
export interface OverlapRow {
  readonly assignmentId: string;
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date;
}

/** Warum eine Schreibanfrage nicht ausgefuehrt wurde. */
export type PlanningWriteProblem =
  /** Angemeldet, aber ohne aktive Mitgliedschaft. */
  | { readonly kind: "NO_ORGANISATION" }
  /** Mehrere aktive Mitgliedschaften — keine stille Auswahl (EYT-14). */
  | { readonly kind: "AMBIGUOUS_ORGANISATION" }
  /**
   * Die Person oder die Baustelle ist im Mandanten nicht sichtbar oder nicht
   * mehr aktiv. Beides zusammen, weil die Unterscheidung "existiert nicht" vs.
   * "gehoert einem anderen Mandanten" dem Aufrufer nichts verraten darf.
   */
  | { readonly kind: "RESOURCE_NOT_SELECTABLE"; readonly feld: "employeeId" | "worksiteId" }
  /**
   * Die Person hat in DIESEM Entwurf bereits einen ueberlappenden Einsatz.
   * Enthaelt die kollidierende Zeile, damit die Meldung sagen kann, WOMIT es
   * kollidiert — "Konflikt" allein ist fuer eine Planerin nicht handhabbar.
   */
  | { readonly kind: "OVERLAPPING_ASSIGNMENT"; readonly overlap: OverlapRow }
  /**
   * Der Einsatz liegt nicht in der angefragten Woche. Ohne diese Pruefung
   * koennte ein Entwurf fuer W32 eine Zeile in W40 anlegen, und die Woche, in
   * der sie erscheint, waere nicht die, in der sie angelegt wurde.
   */
  | { readonly kind: "OUTSIDE_WEEK"; readonly tatsaechlicheWoche: string }
  /**
   * Derselbe Idempotenzschluessel, aber eine ANDERE Anfrage.
   *
   * Keine Wiederholung, sondern ein Aufruferfehler. Die alte Antwort
   * zurueckzugeben waere die schlechteste Reaktion: der Aufrufer bekaeme ein
   * "angelegt" fuer etwas, das er nie geschickt hat.
   */
  | { readonly kind: "IDEMPOTENCY_KEY_REUSED" }
  /**
   * Der Client arbeitete auf einem anderen Stand als dem, der jetzt gilt
   * (EYT-107). `aktuelleVersionId` ist `null`, wenn es fuer die Woche
   * ueberhaupt keinen Entwurf mehr gibt.
   *
   * Getrennt von {@link PlanningWriteProblem} `ALREADY_PUBLISHED`, obwohl beide
   * 409 sind: „jemand hat den Entwurf veraendert" und „die Woche ist fertig"
   * verlangen von der Planerin verschiedene Reaktionen.
   */
  | { readonly kind: "STALE_VERSION"; readonly aktuelleVersionId: string | null }
  /** Fuer diese Woche gibt es keinen unveroeffentlichten Entwurf mehr. */
  | { readonly kind: "ALREADY_PUBLISHED"; readonly versionId: string }
  /**
   * Der Entwurf traegt mindestens einen blockierenden Konflikt.
   *
   * Traegt die Liste mit, damit die Meldung sagen kann, WAS blockiert —
   * „Konflikt" allein ist fuer eine Planerin nicht handhabbar.
   */
  | { readonly kind: "BLOCKING_CONFLICT"; readonly conflicts: readonly ValidatedConflict[] }
  /**
   * Mindestens eine Zuweisung des Entwurfs liegt nach der Zeitzone der
   * Organisation nicht in der Woche der Planversion.
   *
   * Diese Pruefung existiert, weil das SCHEMA sie nicht kennt: `week_key` ist
   * mit keinem Zeitstempel verknuepft (bekannte Luecke aus EYT-49). Ohne sie
   * koennte eine Woche mit fachlich fremden Zeiten veroeffentlicht werden, und
   * ein spaeterer Kosten-Snapshot rechnete auf ihnen.
   */
  | { readonly kind: "ASSIGNMENT_OUTSIDE_WEEK"; readonly tatsaechlicheWoche: string };

export type CreateAssignmentResult =
  | {
      readonly ok: true;
      readonly assignment: CreatedAssignmentRow;
      /**
       * `true`, wenn dieser Aufruf die Wiederholung eines frueheren war und
       * dessen Ergebnis zurueckgibt, ohne etwas zu schreiben.
       *
       * Steht im Ergebnis und nicht nur im Log, weil ein Test sonst nicht
       * unterscheiden koennte, ob der zweite Aufruf wirklich NICHTS getan hat
       * oder nur zufaellig dasselbe Ergebnis erzeugte.
       */
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly problem: PlanningWriteProblem };

export interface CreateAssignmentInput {
  /** ISO-Woche, in der der Einsatz liegen MUSS. Bereits vertraglich geprueft. */
  readonly weekKey: string;
  readonly employeeId: string;
  readonly worksiteId: string;
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date;
  /**
   * Mandantengebundener Wiederholungsschutz aus dem `Idempotency-Key`-Header.
   *
   * Pflicht, nicht optional: ein Schreibvorgang ohne Schluessel liesse sich
   * nicht wiederholen, ohne zu verdoppeln. Der Vertrag verlangt den Header
   * bereits (`idempotencyHeader` im OpenAPI-Dokument) — bis EYT-92 las ihn nur
   * niemand.
   */
  readonly idempotencyKey: string;
}

export interface PlanningWrites {
  /**
   * Prueft einen Entwurf gegen den Bestand — OHNE Schreibwirkung.
   *
   * Deshalb ohne Idempotenzschluessel: es entsteht nichts, was sich
   * verdoppeln koennte. Und deshalb im Schreibport statt im Leseport: die
   * Pruefung braucht dieselbe Mandantenklammer und dieselbe
   * Schreibberechtigung wie das Anlegen — wer nicht schreiben darf, soll auch
   * nicht ausprobieren duerfen, was ein Schreibvorgang ergaebe.
   */
  validateDraft(input: ValidateDraftInput): Promise<ValidateDraftResult>;

  /**
   * Legt eine Zuweisung im Entwurf der Woche an — und den Entwurf selbst, falls
   * es noch keinen gibt. Beides in EINER Transaktion: ein angelegter Entwurf
   * ohne die Zuweisung, fuer die er entstand, waere ein leerer Datensatz, den
   * niemand angefordert hat.
   */
  createAssignment(input: CreateAssignmentInput): Promise<CreateAssignmentResult>;

  /**
   * Veroeffentlicht den Entwurf einer Woche — atomar oder gar nicht (EYT-107).
   *
   * Setzt `plan_versions.published_at` genau einmal; den Rest erledigt die
   * Datenbank: der Trigger aus Migration 0010 spiegelt den Marker nach
   * `assignments.published_at`, und der partielle EXCLUDE lehnt dabei einen
   * ueberlappenden Entwurf ab. Auditzeile, Outbox-Nachricht und
   * Idempotenzergebnis liegen in derselben Transaktion.
   */
  publishPlan(input: PublishPlanInput): Promise<PublishPlanResult>;
}

export interface PublishPlanInput {
  readonly weekKey: string;
  /**
   * Der Stand, auf dem der Client arbeitet — die Id des Entwurfs, den er
   * gesehen hat. `null` heisst „ich erwarte, dass es fuer diese Woche noch
   * keine Version gibt".
   *
   * Pflichtfeld, auch wenn `null` erlaubt ist: ein fehlendes Feld waere von
   * „ich habe keinen Stand gesehen" nicht zu unterscheiden, und der Server
   * wuerde blind veroeffentlichen, was gerade dasteht.
   */
  readonly expectedVersionId: string | null;
  readonly idempotencyKey: string;
}

/** Die veroeffentlichte Planversion, so wie sie in der Datenbank steht. */
export interface PublishedPlanVersionRow {
  readonly versionId: string;
  readonly weekKey: string;
  readonly publishedAtUtc: Date;
  /** Die Zuweisungen, die mit dieser Version verbindlich geworden sind. */
  readonly assignmentIds: readonly string[];
}

export type PublishPlanResult =
  | {
      readonly ok: true;
      readonly version: PublishedPlanVersionRow;
      /** `true`, wenn dieser Aufruf die Wiederholung eines frueheren war. */
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly problem: PlanningWriteProblem };

/** Baut den Schreibport fuer ein verifiziertes Subjekt. Siehe planning-queries.factory. */
export type PlanningWritesFactory = (subjectUserId: string) => PlanningWrites;

export const PLANNING_WRITES_FACTORY = "PLANNING_WRITES_FACTORY";

/** Ein Entwurf, wie ihn die Validierungsroute prueft. Ohne Schreibwirkung. */
export interface ValidateDraftInput {
  readonly weekKey: string;
  readonly employeeId: string;
  readonly worksiteId: string;
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date;
}

export interface ValidatedConflict {
  readonly code: string;
  readonly blocking: boolean;
  readonly message: string;
}

export type ValidateDraftResult =
  | {
      readonly ok: true;
      readonly conflicts: readonly ValidatedConflict[];
      readonly publishable: boolean;
    }
  | { readonly ok: false; readonly problem: PlanningWriteProblem };
