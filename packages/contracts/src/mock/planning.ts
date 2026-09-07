/**
 * Mock-Planer-Gateway (EYT-79).
 *
 * Zweck: die Rollen-Shell klickbar machen, **ohne** eine Backendfunktion
 * vorzutaeuschen. Jede Antwort stammt aus einem sichtbar synthetischen
 * Datenbestand; der Konstruktor verlangt ihn ausdruecklich, es gibt keine
 * eingebauten Demodaten.
 *
 * `induce` setzt gezielt einen Fehlerzustand, damit die Shell Fehler-, Leer- und
 * Stale-Version-Darstellung zeigen kann, ohne dass jemand den Server abschaltet.
 */
import { gatewayFailed, gatewayOk, type GatewayFailure, type GatewayResult } from "../gateway.js";
import type { WriteOptions } from "../planning/gateway.js";
import type { EngagementGateway, PlanningGateway } from "../planning/gateway.js";
import { isoWeekKeyOf } from "../planning/iso-week.js";
import { deriveEffectiveWorkdays } from "../planning/workdays.js";
import type {
  AssignmentDto,
  CreateAssignmentCommand,
  CreateEngagementCommand,
  EngagementDayDto,
  EngagementDto,
  PlanWorksiteDayCommand,
  PlanValidationResult,
  PlanningWindow,
  PlanningResources,
  PlanningWindowQuery,
  PublishPlanCommand,
  PublishedPlanVersion,
  UpdateWorksiteDayTeamCommand,
  WorksiteDayDto,
  WorksiteDayTeamEntry,
  ValidatePlanCommand,
} from "../planning/schemas.js";
import {
  CreateAssignmentCommandSchema,
  CreateEngagementCommandSchema,
  PlanWorksiteDayCommandSchema,
  UpdateWorksiteDayTeamCommandSchema,
  ValidatePlanCommandSchema,
} from "../planning/schemas.js";
import { IdempotencyKeySchema } from "../primitives.js";

/**
 * Zustand einer einzelnen Woche.
 *
 * Bewusst je Woche und nicht global: eine einzige `publishedVersionId` fuer den
 * ganzen Mock haette die Version aus Woche 32 auch fuer Woche 40 gemeldet, und
 * eine Veroeffentlichung in Woche 40 haette das Ergebnis aus Woche 32 geliefert.
 * Die Stale-Version-Semantik ist aber ausdruecklich pro Planungsfenster — ein
 * Mock, der das vermischt, laesst die Shell einen Zustand ueben, den es nicht gibt.
 */
export interface MockWeekState {
  readonly assignments: readonly AssignmentDto[];
  readonly publishedVersionId: string | null;
  readonly publishResult: PublishedPlanVersion;
}

export interface MockPlanningState {
  readonly timeZone: string;
  /**
   * Auswaehlbare Stammdaten. Ohne Standardwert und ohne eingebaute Demonamen —
   * dieselbe Begruendung wie fuer den ganzen Mock: was hier erscheint, hat ein
   * Test ausdruecklich hingeschrieben. Ein eingebauter Vorrat an „Max
   * Mustermann" liesse eine Auswahlliste befuellt aussehen, ohne dass irgendwo
   * eine Datenquelle existiert.
   */
  readonly resources: PlanningResources;
  /** Wochenschluessel -> Wochenzustand. Fehlt der Schluessel, ist die Woche leer und unveroeffentlicht. */
  readonly weeks: ReadonlyMap<string, MockWeekState>;
  /**
   * Fest verdrahtete oder explizit vom Test konfigurierte Validierungsantwort.
   * Der Mock besitzt weiterhin keine eigene Fachlogik.
   */
  readonly validation:
    PlanValidationResult | ((input: ValidatePlanCommand) => PlanValidationResult);
  /** Erzeugte Id fuer `createAssignment`. Kein Zufall, damit Tests reproduzierbar bleiben. */
  readonly nextAssignmentId: string;
  /**
   * Ids fuer den Baustellentag, den `planWorksiteDay` zurueckgibt.
   *
   * Ohne Vorgabewert, aus demselben Grund wie `resources`: was der Clickdummy
   * zeigt, hat ein Test ausdruecklich hingeschrieben. Eine eingebaute Konstante
   * liesse eine Antwort echt aussehen, ohne dass jemand sie gewaehlt hat.
   *
   * `assignmentIds` werden den Teameintraegen der Reihe nach zugeteilt. Reicht
   * die Liste nicht, antwortet der Mock mit einer Ablehnung, die genau das sagt
   * — er erfindet keine Id und schneidet das Team nicht still ab.
   */
  readonly nextWorksiteDay: {
    readonly worksiteDayId: string;
    /**
     * Die Baustelle des Tages. Sie MUSS im Fixture stehen: das Aenderungskommando
     * nennt sie nicht, und ohne sie gaebe es hier nichts Richtiges zu uebergeben.
     */
    readonly worksiteId: string;
    /** Der lokale Tag der Identitaet. Das Aenderungskommando nennt ihn nicht — der Mock muss ihn also mitbekommen haben. */
    readonly localDate: string;
    readonly configurationId: string;
    readonly assignmentIds: readonly string[];
  };
  /**
   * Die VORBEREITETE Serverantwort fuer `createEngagement` (EYT-120).
   *
   * Die EINSATZGRENZEN stehen hier NICHT: sie sind lokale Geschaeftsdaten und kommen
   * unveraendert aus dem Kommando zurueck (D-003). Was hier steht, sind die Ids und je
   * Tag die fertigen UTC-Zeitpunkte `startUtc`/`endUtc` der Zuweisungen (Schreibweise wie
   * `InstantSchema`) — der Mock rechnet keine lokale Zeit in eine Zone um, siehe den
   * Kopfkommentar an `createEngagement`.
   *
   * Die Tage werden ueber `localDate` den ABGELEITETEN Arbeitstagen zugeordnet, die
   * Reihenfolge spielt keine Rolle; `assignmentIds` gehen innerhalb eines Tages
   * in Teamreihenfolge an die Mitglieder. Fehlt ein abgeleiteter Tag hier oder
   * reichen seine `assignmentIds` nicht fuer das Team, lehnt der Mock ab und
   * nennt den Tag — er erfindet keine Id und laesst keinen Tag still weg.
   *
   * Optional, damit ein Fixture ohne Einsatz gueltig bleibt: ohne diesen Block
   * antwortet `createEngagement` mit derselben Ablehnung wie ein zu kurzes
   * Fixture. Ein Vorgabewert waere eine eingebaute Konstante, gegen die eine
   * Zusicherung pruefen koennte, ohne dass jemand sie gewaehlt hat.
   */
  readonly nextEngagement?: {
    readonly engagementId: string;
    readonly days: readonly {
      readonly localDate: string;
      readonly worksiteDayId: string;
      readonly configurationId: string;
      readonly startUtc: string;
      readonly endUtc: string;
      readonly assignmentIds: readonly string[];
    }[];
  };
}

export class MockPlanningGateway implements PlanningGateway, EngagementGateway {
  #induced: GatewayFailure | null = null;
  #lastValidated: ValidatePlanCommand | null = null;
  readonly #assignments = new Map<string, AssignmentDto[]>();
  /** Wochenschluessel -> Baustellentage, die `createEngagement` angelegt hat. */
  readonly #worksiteDays = new Map<string, WorksiteDayDto[]>();
  readonly #idempotency = new Map<
    string,
    { readonly fingerprint: string; readonly assignment: AssignmentDto }
  >();
  /**
   * Schluessel -> Fingerabdruck + gespeicherte Antwort fuer `createEngagement`.
   * Dieselbe Mechanik wie `#idempotency`, eigene Tabelle, weil die gespeicherte
   * Antwort ein `EngagementDto` ist und kein `AssignmentDto`.
   */
  readonly #engagementIdempotency = new Map<
    string,
    { readonly fingerprint: string; readonly engagement: EngagementDto }
  >();

  constructor(private readonly state: MockPlanningState) {
    for (const [weekKey, week] of state.weeks) {
      this.#assignments.set(weekKey, [...week.assignments]);
    }
  }

  /** Naechster Aufruf schlaegt mit diesem Grund fehl. `null` hebt es auf. */
  induce(failure: GatewayFailure | null): void {
    this.#induced = failure;
  }

  #maybeFail<T>(): GatewayResult<T> | null {
    if (this.#induced === null) return null;
    const failure = this.#induced;
    this.#induced = null;
    return gatewayFailed<T>(failure, {
      type: "about:blank",
      title: "Induzierter Mockfehler",
      status: failure === "FORBIDDEN" ? 403 : 500,
      detail: "Dieser Fehler wurde vom Clickdummy absichtlich ausgeloest.",
      correlationId: "mock-correlation-id",
    });
  }

  getPlanningWindow(input: PlanningWindowQuery): Promise<GatewayResult<PlanningWindow>> {
    const failed = this.#maybeFail<PlanningWindow>();
    if (failed !== null) return Promise.resolve(failed);
    const week = this.state.weeks.get(input.weekKey);
    return Promise.resolve(
      gatewayOk({
        weekKey: input.weekKey,
        timeZone: this.state.timeZone,
        assignments: [...(this.#assignments.get(input.weekKey) ?? [])],
        // Der Mock kennt nur veroeffentlichte Staende; einen Entwurf ueber
        // einer Veroeffentlichung bildet er bewusst nicht nach. Wer diesen
        // Fall pruefen will, braucht den echten Server (EYT-50 AK10).
        sourceVersion:
          week?.publishedVersionId === undefined || week.publishedVersionId === null
            ? null
            : { id: week.publishedVersionId, state: "published" as const },
        publishedVersionId: week?.publishedVersionId ?? null,
        resources: this.state.resources,
        // Die Tage aus `createEngagement` (EYT-120). Dieselbe Grenze wie bei
        // `sourceVersion`: in einer Woche ohne veroeffentlichte Version meldet
        // der Mock `sourceVersion: null`, und `PlanningWindowSchema` verwirft
        // ein Fenster mit Tagen ohne Herkunft — so wie es Zuweisungen aus
        // `createAssignment` dort schon verwirft. Wer Tage in einer
        // unveroeffentlichten Woche sehen will, braucht den echten Server.
        worksiteDays: [...(this.#worksiteDays.get(input.weekKey) ?? [])],
      }),
    );
  }

  validateDraft(input: ValidatePlanCommand): Promise<GatewayResult<PlanValidationResult>> {
    // Der Mock rechnet NICHT — er merkt sich nur, was geprueft werden sollte.
    // Ein Test kann damit belegen, DASS der Aufruf kam und womit; er kann daraus
    // aber nicht ableiten, dass die Konfliktpruefung stimmt.
    this.#lastValidated = input;
    const failed = this.#maybeFail<PlanValidationResult>();
    if (failed !== null) return Promise.resolve(failed);
    const parsed = ValidatePlanCommandSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:invalid-interval",
          "Prüfauftrag unvollständig oder Intervall ungültig",
          400,
        ),
      );
    }
    const validation =
      typeof this.state.validation === "function"
        ? this.state.validation(parsed.data)
        : this.state.validation;
    return Promise.resolve(gatewayOk(validation));
  }

  /** Zuletzt geprueter Entwurf, oder `null`, solange keiner geprueft wurde. */
  get lastValidated(): ValidatePlanCommand | null {
    return this.#lastValidated;
  }

  createAssignment(
    input: CreateAssignmentCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<AssignmentDto>> {
    const failed = this.#maybeFail<AssignmentDto>();
    if (failed !== null) return Promise.resolve(failed);

    const parsed = CreateAssignmentCommandSchema.safeParse(input);
    const key = IdempotencyKeySchema.safeParse(options.idempotencyKey);
    if (!parsed.success || !key.success) {
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:invalid-interval",
          "Einsatz unvollständig oder Intervall ungültig",
          400,
        ),
      );
    }

    const fingerprint = JSON.stringify(parsed.data);
    const previous = this.#idempotency.get(key.data);
    if (previous !== undefined) {
      return Promise.resolve(
        previous.fingerprint === fingerprint
          ? gatewayOk(previous.assignment)
          : planningRejected(
              "urn:easytree:planning:idempotency-key-reused",
              "Idempotenzschlüssel wurde für einen anderen Einsatz wiederverwendet",
              409,
            ),
      );
    }

    const start = Date.parse(parsed.data.interval.startUtc);
    const end = Date.parse(parsed.data.interval.endUtc);
    const overlap = (this.#assignments.get(parsed.data.weekKey) ?? []).find(
      (assignment) =>
        assignment.employeeId === parsed.data.employeeId &&
        Date.parse(assignment.interval.startUtc) < end &&
        start < Date.parse(assignment.interval.endUtc),
    );
    if (overlap !== undefined) {
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:overlapping-assignment",
          "Mitarbeitende Person ist in diesem Zeitraum bereits eingeplant",
          409,
        ),
      );
    }

    const assignment: AssignmentDto = {
      id: this.state.nextAssignmentId,
      employeeId: parsed.data.employeeId,
      worksiteId: parsed.data.worksiteId,
      interval: parsed.data.interval,
    };
    const assignments = this.#assignments.get(parsed.data.weekKey) ?? [];
    this.#assignments.set(parsed.data.weekKey, [...assignments, assignment]);
    this.#idempotency.set(key.data, { fingerprint, assignment });
    return Promise.resolve(gatewayOk(assignment));
  }

  /**
   * Legt einen Baustellentag an — als ANTWORTFORM, nicht als Fachlogik.
   *
   * Der Mock fuehrt keinen Tagesbestand: er prueft das Kommando gegen das
   * Schema und setzt aus den Fixture-Ids eine vertragskonforme Antwort
   * zusammen. Er erkennt deshalb weder ein Duplikat noch eine Kollision mit
   * bestehenden Zuweisungen. Wer das pruefen will, braucht den echten Server —
   * dieselbe Grenze, die schon fuer `validateDraft` gilt.
   */
  planWorksiteDay(
    input: PlanWorksiteDayCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<WorksiteDayDto>> {
    const failed = this.#maybeFail<WorksiteDayDto>();
    if (failed !== null) return Promise.resolve(failed);

    const parsed = PlanWorksiteDayCommandSchema.safeParse(input);
    const key = IdempotencyKeySchema.safeParse(options.idempotencyKey);
    if (!parsed.success || !key.success) {
      // Der Mock sagt NICHT, welche Regel gebrochen wurde. Eine geratene
      // Zuordnung waere schlimmer als keine: sie schickte den Leser auf die
      // falsche Faehrte, und der echte Server vergibt seine eigene.
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:invalid-interval",
          "Baustellentag unvollstaendig, Team leer oder Intervall ungueltig",
          400,
        ),
      );
    }

    return Promise.resolve(
      this.#baustellentag({
        worksiteId: parsed.data.worksiteId,
        localDate: parsed.data.localDate,
        lockVersion: 0,
        team: parsed.data.team,
      }),
    );
  }

  /**
   * Ersetzt die Tagesbesetzung — mit einer FORTGESCHRIEBENEN `lockVersion`.
   *
   * Ehrlichkeitshinweis: der Mock kennt den echten Stand des Tages nicht und
   * kann deshalb keinen veralteten erkennen. Er schreibt schlicht die vom
   * Aufrufer genannte Erwartung um eins fort. Der `STALE_WORKSITE_DAY`-Fall ist
   * hier NICHT ueberbar — er gehoert dem echten Server.
   */
  updateWorksiteDayTeam(
    input: UpdateWorksiteDayTeamCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<WorksiteDayDto>> {
    const failed = this.#maybeFail<WorksiteDayDto>();
    if (failed !== null) return Promise.resolve(failed);

    const parsed = UpdateWorksiteDayTeamCommandSchema.safeParse(input);
    const key = IdempotencyKeySchema.safeParse(options.idempotencyKey);
    if (!parsed.success || !key.success) {
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:invalid-interval",
          "Teamaenderung unvollstaendig, Team leer oder Intervall ungueltig",
          400,
        ),
      );
    }

    return Promise.resolve(
      this.#baustellentag({
        // Baustelle UND Tag haengen an der IDENTITAET und stehen bewusst nicht im
        // Kommando — der Mock nimmt beide aus seinem Fixture.
        worksiteId: this.state.nextWorksiteDay.worksiteId,
        localDate: this.state.nextWorksiteDay.localDate,
        lockVersion: parsed.data.expectedLockVersion + 1,
        team: parsed.data.team,
        worksiteDayId: parsed.data.worksiteDayId,
      }),
    );
  }

  /**
   * Setzt die Antwortform zusammen — ohne Fachlogik, nur aus Fixture-Ids.
   *
   * BENANNTE Felder statt Stellungsparameter, und das ist kein Stil: drei
   * aufeinanderfolgende `string`-Parameter fuer `worksiteId`, `localDate` und
   * `worksiteDayId` liessen sich vertauschen, ohne dass Typsystem, Schema oder
   * ein Rundlauf durch `parse` es meldeten. Mit Feldnamen muss ein Tausch
   * ausgeschrieben werden und faellt beim Lesen auf.
   */
  #baustellentag(eingabe: {
    readonly worksiteId: string;
    readonly localDate: string;
    readonly lockVersion: number;
    readonly team: readonly WorksiteDayTeamEntry[];
    readonly worksiteDayId?: string;
  }): GatewayResult<WorksiteDayDto> {
    const { worksiteId, localDate, lockVersion, team } = eingabe;
    const worksiteDayId = eingabe.worksiteDayId ?? this.state.nextWorksiteDay.worksiteDayId;
    const ids = this.state.nextWorksiteDay.assignmentIds;
    if (team.length > ids.length) {
      return planningRejected<WorksiteDayDto>(
        "urn:easytree:planning:invalid-interval",
        `Der Clickdummy haelt ${ids.length} Assignment-Ids bereit, das Team hat ${team.length}. ` +
          "Fixture erweitern statt Ids zu erfinden.",
        400,
      );
    }
    return gatewayOk<WorksiteDayDto>({
      worksiteDayId,
      configurationId: this.state.nextWorksiteDay.configurationId,
      worksiteId,
      localDate,
      lockVersion,
      team: team.map((eintrag, index) => {
        const assignmentId = ids[index];
        // Der Laengenriegel oben schliesst das aus. Ein `?? ""` stuende hier
        // als stille Ersatz-Id und ergaebe eine Antwort, die kein Schema mehr
        // annimmt — der Fehler waere dann beim Aufrufer statt hier.
        if (assignmentId === undefined) {
          throw new Error("Clickdummy: Assignment-Id fehlt trotz Laengenpruefung");
        }
        return { assignmentId, employeeId: eintrag.employeeId, interval: eintrag.interval };
      }),
    });
  }

  /**
   * Legt einen Einsatz mit seinen Tagen an (EYT-120) — als ANTWORTFORM plus
   * Zustand, nicht als Fachlogik.
   *
   * Was der Mock tut: das Kommando gegen das Schema pruefen, den
   * Idempotenzschluessel wie bei `createAssignment` behandeln (gleicher
   * Schluessel + gleiches Kommando = gespeicherte Antwort, gleicher Schluessel +
   * anderes Kommando = Ablehnung), die Arbeitstage mit `deriveEffectiveWorkdays`
   * ABLEITEN (Mo–Fr im Zeitraum bzw. bis zum Planungshorizont, optionaler
   * Kalender-Override), je abgeleitetem Tag den vorbereiteten Fixture-Tag ueber
   * `localDate` heraussuchen, die Woche des Tages ueber dieselbe Kalenderrechnung
   * wie der Vertrag bestimmen und Tage samt Zuweisungen ablegen, damit
   * `getPlanningWindow` sie zeigt.
   *
   * Die Tagesableitung ist bewusst KEINE zweite Rechnung: sie ist genau die
   * Funktion, die auch `CreateEngagementCommandSchema` verwendet. Ein Clickdummy,
   * der eine eigene Wochentagsregel mitbraechte, zeigte der Oberflaeche andere
   * Tage als der Server (D-005).
   *
   * ## Warum der Clickdummy keine Zeitzone rechnet
   *
   * Die Einsatzgrenzen sind lokale Daten und brauchen keine Umrechnung. Die
   * Instants je Tag — `startUtc`/`endUtc` — kommen FERTIG aus
   * `state.nextEngagement`. Der Mock loest keine lokale
   * Uhrzeit in einer Zone auf, und `state.timeZone` wird hier nicht gelesen:
   *
   * 1. Zeitmathematik gehoert `@easytree/domain`. Dieses Paket importiert
   *    `domain` bewusst nicht (ADR-001), und eine zweite Umrechnung hier waere
   *    eine zweite Wahrheit — mit eigenen Fehlern, die kein Test der Domaene
   *    sieht.
   * 2. Der Waechter `no-local-time-construction` (EYT-61 AK6a) ist die Grenze:
   *    kein Produktionscode baut einen Instant aus Wanduhrteilen. Ein Mock, der
   *    das doch tut, waere entweder ein Treffer des Waechters oder ein Umweg um
   *    ihn herum — beides falsch.
   * 3. Die Sommerzeitfaelle beantwortet nur der Server: eine nicht existente
   *    Zeit (`LOCAL_TIME_NONEXISTENT`) oder eine mehrdeutige
   *    (`LOCAL_TIME_AMBIGUOUS`) lehnt er benannt ab. Eine eigene Rechnung im
   *    Clickdummy legte solche Zeiten still auf einen Kandidaten — ein UI-Test
   *    an der Umstellung waere gegen den Mock gruen und gegen den Server rot.
   *
   * Der Clickdummy haelt deshalb VORBEREITETE SERVERANTWORTEN, keine Rechnung.
   *
   * Was er NICHT tut, und ehrlich nicht kann: eine nicht existente oder
   * mehrdeutige Sommerzeit-Zeit in einer OPTIONAL mitgegebenen Arbeitszeit oder
   * einen bereits vergebenen Tag erkennen. Diese Problem-Types
   * (`ENGAGEMENT_PROBLEM_TYPE`) gehoeren dem echten Server — dieselbe Grenze wie
   * `STALE_WORKSITE_DAY` beim Teamwechsel.
   */
  createEngagement(
    input: CreateEngagementCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<EngagementDto>> {
    const failed = this.#maybeFail<EngagementDto>();
    if (failed !== null) return Promise.resolve(failed);

    const parsed = CreateEngagementCommandSchema.safeParse(input);
    const key = IdempotencyKeySchema.safeParse(options.idempotencyKey);
    if (!parsed.success || !key.success) {
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:invalid-interval",
          "Einsatz unvollstaendig, Overrides ausserhalb des Zeitraums, kein Arbeitstag oder Team leer",
          400,
        ),
      );
    }
    const kommando = parsed.data;

    // Idempotenz VOR dem Fixture-Abgleich, wie bei `createAssignment`: ein
    // Replay darf weder ein zweites Mal anlegen noch an einem inzwischen
    // geaenderten Fixture scheitern.
    const fingerprint = einsatzFingerabdruck(kommando);
    const previous = this.#engagementIdempotency.get(key.data);
    if (previous !== undefined) {
      return Promise.resolve(
        previous.fingerprint === fingerprint
          ? gatewayOk(previous.engagement)
          : planningRejected<EngagementDto>(
              "urn:easytree:planning:idempotency-key-reused",
              "Idempotenzschlüssel wurde für einen anderen Einsatz wiederverwendet",
              409,
            ),
      );
    }

    const vorbereitet = this.state.nextEngagement;
    if (vorbereitet === undefined) {
      return Promise.resolve(
        planningRejected<EngagementDto>(
          "urn:easytree:planning:invalid-interval",
          "Der Clickdummy haelt keinen Einsatz bereit. Fixture erweitern statt Ids zu erfinden.",
          400,
        ),
      );
    }
    const fixtureTage = new Map(vorbereitet.days.map((tag) => [tag.localDate, tag]));

    // Die effektiven Arbeitstage ENTSTEHEN hier — sie stehen nicht im Kommando.
    // Umfangsende ist das fachliche Ende, sonst der Planungshorizont. Das Schema
    // hat das Ende/Horizont-XOR nach HUMAN_PO_HP1_2026_09_07 sichergestellt.
    const umfangsEnde = kommando.endDate ?? kommando.planningHorizonDate;
    if (umfangsEnde === null) {
      throw new Error("Clickdummy: weder Ende noch Horizont trotz Vertragspruefung");
    }
    const arbeitstage = deriveEffectiveWorkdays(kommando.startDate, umfangsEnde, kommando.calendar);

    /** Je Tag der Antwort-DTO und die Zuweisungen, die sein Team im Fenster belegen. */
    const angelegt: { readonly tag: EngagementDayDto; readonly zuweisungen: AssignmentDto[] }[] =
      [];
    for (const localDate of arbeitstage) {
      const vorlage = fixtureTage.get(localDate);
      if (vorlage === undefined) {
        return Promise.resolve(
          planningRejected<EngagementDto>(
            "urn:easytree:planning:invalid-interval",
            `Der Clickdummy haelt fuer ${localDate} keinen Tag bereit. ` +
              "Fixture erweitern statt Ids zu erfinden.",
            400,
          ),
        );
      }
      if (vorlage.assignmentIds.length < kommando.team.length) {
        return Promise.resolve(
          planningRejected<EngagementDto>(
            "urn:easytree:planning:invalid-interval",
            `Der Clickdummy haelt fuer ${localDate} ${vorlage.assignmentIds.length} ` +
              `Assignment-Ids bereit, das Team hat ${kommando.team.length}. ` +
              "Fixture erweitern statt Ids zu erfinden.",
            400,
          ),
        );
      }
      const interval = { startUtc: vorlage.startUtc, endUtc: vorlage.endUtc };
      const zuweisungen: AssignmentDto[] = [];
      const team = kommando.team.map((employeeId, index) => {
        const assignmentId = vorlage.assignmentIds[index];
        // Der Laengenriegel oben schliesst das aus — siehe `#baustellentag`.
        if (assignmentId === undefined) {
          throw new Error("Clickdummy: Assignment-Id fehlt trotz Laengenpruefung");
        }
        zuweisungen.push({
          id: assignmentId,
          employeeId,
          worksiteId: kommando.worksiteId,
          interval,
        });
        return { assignmentId, employeeId, interval };
      });
      angelegt.push({
        tag: {
          worksiteDayId: vorlage.worksiteDayId,
          configurationId: vorlage.configurationId,
          worksiteId: kommando.worksiteId,
          localDate,
          lockVersion: 0,
          team,
          weekKey: isoWeekKeyOf(localDate),
        },
        zuweisungen,
      });
    }

    // Erst nach vollstaendigem Aufbau in den Zustand — EINE Transaktion, auch
    // im Clickdummy: ein Fehler oben hinterlaesst keinen halben Einsatz.
    for (const { tag, zuweisungen } of angelegt) {
      // Ohne `weekKey`: das Fenster fuehrt Tage als `WorksiteDayDto`, und das
      // Schema ist strikt — ein mitgeschleppter Wochenschluessel machte das
      // ganze Fenster unlesbar.
      const { weekKey, ...ohneWoche } = tag;
      this.#worksiteDays.set(weekKey, [...(this.#worksiteDays.get(weekKey) ?? []), ohneWoche]);
      this.#assignments.set(weekKey, [...(this.#assignments.get(weekKey) ?? []), ...zuweisungen]);
    }

    const engagement: EngagementDto = {
      engagementId: vorbereitet.engagementId,
      worksiteId: kommando.worksiteId,
      // Datumsgrenzen unveraendert aus dem Kommando: der Horizont bleibt neben
      // `endDate` stehen und wird nicht still hineinkopiert (D-006).
      startDate: kommando.startDate,
      endDate: kommando.endDate,
      planningHorizonDate: kommando.planningHorizonDate,
      days: angelegt.map(({ tag }) => tag),
    };
    this.#engagementIdempotency.set(key.data, { fingerprint, engagement });
    return Promise.resolve(gatewayOk(engagement));
  }

  publishPlan(input: PublishPlanCommand): Promise<GatewayResult<PublishedPlanVersion>> {
    const failed = this.#maybeFail<PublishedPlanVersion>();
    if (failed !== null) return Promise.resolve(failed);
    const week = this.state.weeks.get(input.weekKey);
    // Stale-Version-Erkennung ist auch im Mock echt und PRO WOCHE: sonst koennte
    // die Shell den Zustand nie zeigen, den sie behandeln muss — und ein
    // wochenuebergreifender Vergleich wuerde einen Konflikt melden, den es in
    // der angefragten Woche gar nicht gibt.
    if (input.expectedVersionId !== (week?.publishedVersionId ?? null)) {
      return Promise.resolve(
        gatewayFailed<PublishedPlanVersion>("STALE_VERSION", {
          type: "about:blank",
          title: "Veralteter Planstand",
          status: 409,
          detail: "Seit dem Laden wurde eine neue Planversion veroeffentlicht.",
          correlationId: "mock-correlation-id",
        }),
      );
    }
    if (week === undefined) {
      return Promise.resolve(
        gatewayFailed<PublishedPlanVersion>("REJECTED", {
          type: "about:blank",
          title: "Unbekanntes Planungsfenster",
          status: 404,
          detail: `Fuer ${input.weekKey} ist im Clickdummy kein Zustand hinterlegt.`,
          correlationId: "mock-correlation-id",
        }),
      );
    }
    return Promise.resolve(gatewayOk(week.publishResult));
  }
}

/**
 * Deterministischer Fingerabdruck eines Einsatz-Kommandos fuer die Idempotenz.
 *
 * `JSON.stringify(parsed.data)` wie bei `createAssignment` genuegt hier nicht:
 * `calendar.include`, `calendar.exclude` und `team` sind MENGEN, keine Folgen —
 * dieselbe Auswahl in anderer Reihenfolge ist dasselbe Kommando und muss denselben
 * Abdruck ergeben, sonst meldete ein legitimer Netz-Retry einen 409. Deshalb
 * kanonische Feldreihenfolge, alle drei Listen sortiert, ein fehlender Kalender und
 * eine fehlende Arbeitszeit ausdruecklich als `null` statt weggelassen.
 *
 * Sortiert wird ueber Code-Units, nicht `localeCompare`: das haengt an der
 * Umgebung, nicht am Kommando.
 *
 * Die abgeleiteten Arbeitstage gehen NICHT in den Abdruck ein — sie sind eine
 * Funktion der Eingaben, die schon darin stehen. Ein zweites Mal aufgenommen
 * waeren sie eine abgeleitete Groesse, die bei jeder Regelaenderung stillschweigend
 * alle gespeicherten Schluessel entwertete.
 */
function einsatzFingerabdruck(kommando: CreateEngagementCommand): string {
  const kalender = kommando.calendar;
  return JSON.stringify({
    worksiteId: kommando.worksiteId,
    startDate: kommando.startDate,
    endDate: kommando.endDate,
    planningHorizonDate: kommando.planningHorizonDate,
    calendar:
      kalender === undefined
        ? null
        : { include: [...kalender.include].sort(), exclude: [...kalender.exclude].sort() },
    defaults: {
      workingTime:
        kommando.defaults?.workingTime === undefined
          ? null
          : { from: kommando.defaults.workingTime.from, to: kommando.defaults.workingTime.to },
    },
    team: [...kommando.team].sort(),
  });
}

function planningRejected<T>(type: string, detail: string, status: number): GatewayResult<T> {
  return gatewayFailed<T>("REJECTED", {
    type,
    title: status === 409 ? "Planungskonflikt" : "Ungültige Planung",
    status,
    detail,
    correlationId: "mock-correlation-id",
  });
}
