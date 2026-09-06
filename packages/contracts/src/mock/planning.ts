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
   * Ids fuer den Einsatz, den `createEngagement` zurueckgibt (EYT-120).
   *
   * Derselbe Mechanismus wie `nextWorksiteDay`, nur je Tag: `worksiteDayIds` und
   * `configurationIds` werden den ausgewaehlten Tagen der Reihe nach zugeteilt,
   * `assignmentIds` den Paaren (Tag, Teammitglied) — Tag fuer Tag, innerhalb des
   * Tages in Teamreihenfolge. Reicht eine Liste nicht, lehnt der Mock ab, statt
   * Ids zu erfinden oder Tage still wegzulassen.
   *
   * Optional, damit ein Fixture ohne Einsatz gueltig bleibt: ohne diesen Block
   * antwortet `createEngagement` mit derselben Ablehnung wie ein zu kurzes
   * Fixture. Ein Vorgabewert waere eine eingebaute Konstante, gegen die eine
   * Zusicherung pruefen koennte, ohne dass jemand sie gewaehlt hat.
   */
  readonly nextEngagement?: {
    readonly engagementId: string;
    readonly worksiteDayIds: readonly string[];
    readonly configurationIds: readonly string[];
    readonly assignmentIds: readonly string[];
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
   * Was der Mock tut: das Kommando gegen das Schema pruefen, je ausgewaehltem
   * Tag einen Baustellentag mit Team aus den Fixture-Ids zusammensetzen, die
   * lokalen Zeiten mit `state.timeZone` in Instants aufloesen, die Woche des
   * Tages ueber dieselbe Kalenderrechnung wie der Vertrag bestimmen und Tage
   * samt Zuweisungen ablegen, damit `getPlanningWindow` sie zeigt.
   *
   * Was er NICHT tut, und ehrlich nicht kann: einen Beginn in der Vergangenheit,
   * eine nicht existente oder mehrdeutige Sommerzeit-Zeit, eine Arbeitszeit
   * ausserhalb der Einsatzgrenzen oder einen bereits vergebenen Tag erkennen.
   * Diese Problem-Types (`ENGAGEMENT_PROBLEM_TYPE`) gehoeren dem echten Server —
   * dieselbe Grenze wie `STALE_WORKSITE_DAY` beim Teamwechsel.
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
          "Einsatz unvollstaendig, Tage ausserhalb des Zeitraums oder Team leer",
          400,
        ),
      );
    }
    const kommando = parsed.data;

    const ids = this.state.nextEngagement;
    const tage = kommando.days.length;
    const zuweisungen = tage * kommando.team.length;
    if (
      ids === undefined ||
      ids.worksiteDayIds.length < tage ||
      ids.configurationIds.length < tage ||
      ids.assignmentIds.length < zuweisungen
    ) {
      return Promise.resolve(
        planningRejected<EngagementDto>(
          "urn:easytree:planning:invalid-interval",
          `Der Clickdummy haelt ${ids?.worksiteDayIds.length ?? 0} Tages-, ` +
            `${ids?.configurationIds.length ?? 0} Konfigurations- und ` +
            `${ids?.assignmentIds.length ?? 0} Assignment-Ids bereit; der Einsatz braucht ` +
            `${tage}, ${tage} und ${zuweisungen}. Fixture erweitern statt Ids zu erfinden.`,
          400,
        ),
      );
    }

    const zone = this.state.timeZone;
    /** Je Tag der Antwort-DTO und die Zuweisungen, die sein Team im Fenster belegen. */
    const angelegt: { readonly tag: EngagementDayDto; readonly zuweisungen: AssignmentDto[] }[] =
      [];
    let naechsteZuweisung = 0;
    kommando.days.forEach((tag, index) => {
      const worksiteDayId = ids.worksiteDayIds[index];
      const configurationId = ids.configurationIds[index];
      // Der Laengenriegel oben schliesst das aus — siehe `#baustellentag`.
      if (worksiteDayId === undefined || configurationId === undefined) {
        throw new Error("Clickdummy: Tages-Id fehlt trotz Laengenpruefung");
      }
      const arbeitszeit = tag.workingTime ?? kommando.defaults.workingTime;
      const interval = {
        startUtc: lokalNachUtc(tag.localDate, arbeitszeit.from, zone),
        endUtc: lokalNachUtc(tag.localDate, arbeitszeit.to, zone),
      };
      const zuweisungen: AssignmentDto[] = [];
      const team = kommando.team.map((employeeId) => {
        const assignmentId = ids.assignmentIds[naechsteZuweisung];
        naechsteZuweisung += 1;
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
          worksiteDayId,
          configurationId,
          worksiteId: kommando.worksiteId,
          localDate: tag.localDate,
          lockVersion: 0,
          team,
          weekKey: isoWeekKeyOf(tag.localDate),
        },
        zuweisungen,
      });
    });

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

    return Promise.resolve(
      gatewayOk<EngagementDto>({
        engagementId: ids.engagementId,
        worksiteId: kommando.worksiteId,
        startsAtUtc: lokalNachUtc(kommando.startAt.date, kommando.startAt.time, zone),
        endsAtUtc:
          kommando.endAt === null
            ? null
            : lokalNachUtc(kommando.endAt.date, kommando.endAt.time, zone),
        days: angelegt.map(({ tag }) => tag),
      }),
    );
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
 * Loest lokales Datum + lokale Uhrzeit in der Zone zu einem Instant auf.
 *
 * Nur fuer den Clickdummy. Der Versatz der Zone wird ueber `Intl` am geratenen
 * Zeitpunkt bestimmt und ein zweites Mal am Ergebnis, damit ein Wechsel knapp
 * daneben beruecksichtigt wird. Eine nicht existente Zeit (Sommerzeitluecke)
 * oder eine mehrdeutige (Rueckstellung) wird dabei NICHT erkannt, sondern
 * still auf einen der beiden Kandidaten gelegt — der echte Server lehnt sie
 * benannt ab (`LOCAL_TIME_NONEXISTENT`, `LOCAL_TIME_AMBIGUOUS`).
 */
function lokalNachUtc(date: string, time: string, timeZone: string): string {
  const [jahr, monat, tag] = date.split("-").map(Number);
  const [stunde, minute] = time.split(":").map(Number);
  if (
    jahr === undefined ||
    monat === undefined ||
    tag === undefined ||
    stunde === undefined ||
    minute === undefined
  ) {
    // Unerreichbar nach `CreateEngagementCommandSchema` — aber ein `?? 0`
    // stuende hier als stiller Ersatzwert und ergaebe einen falschen Instant.
    throw new Error(`Clickdummy: ${date} ${time} ist kein lokaler Zeitpunkt`);
  }
  const alsUtc = utcMs(jahr, monat, tag, stunde, minute, 0);
  const ersterVersuch = alsUtc - zonenversatzMs(alsUtc, timeZone);
  return new Date(alsUtc - zonenversatzMs(ersterVersuch, timeZone)).toISOString();
}

/** UTC-Millisekunden ohne die 1900-Umdeutung kleiner Jahreszahlen durch `Date.UTC`. */
function utcMs(
  jahr: number,
  monat1bis12: number,
  tag: number,
  stunde: number,
  minute: number,
  sekunde: number,
): number {
  const d = new Date(0);
  d.setUTCFullYear(jahr, monat1bis12 - 1, tag);
  d.setUTCHours(stunde, minute, sekunde, 0);
  return d.getTime();
}

/** Versatz der Zone zum Zeitpunkt, in Millisekunden (Berlin im Sommer: +7 200 000). */
function zonenversatzMs(zeitpunktMs: number, timeZone: string): number {
  const teile = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(zeitpunktMs));
  const wert = (typ: Intl.DateTimeFormatPartTypes): number =>
    Number(teile.find((teil) => teil.type === typ)?.value ?? Number.NaN);
  const lokalAlsUtc = utcMs(
    wert("year"),
    wert("month"),
    wert("day"),
    wert("hour"),
    wert("minute"),
    wert("second"),
  );
  return lokalAlsUtc - zeitpunktMs;
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
