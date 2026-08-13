/**
 * Vertragsabgeleiteter HTTP-Client des Kostenbereichs (EYT-108 ff.).
 *
 * Bauart wie `http/planning-gateway.ts`: zentrales `send`, Status→Failure,
 * jede 2xx-Antwort durch `safeParse`. Der Organisationsheader kommt aus einer
 * injizierten Funktion — Komponenten kennen weder Header noch Cookies.
 */
import { z } from "zod";

import { gatewayFailed, gatewayOk, type GatewayFailure, type GatewayResult } from "../gateway.js";
import {
  IDEMPOTENCY_HEADER,
  IdSchema,
  IdempotencyKeySchema,
  ProblemDocumentSchema,
  type IdempotencyKey,
  type ProblemDocument,
} from "../primitives.js";
import type { WriteOptions } from "../planning/gateway.js";
import type { CostsGateway } from "../costs/gateway.js";
import {
  CostSnapshotSchema,
  CreateCostSnapshotCommandSchema,
  CreateRateVersionCommandSchema,
  EmployeesForRatesSchema,
  PublishedPlanVersionsQuerySchema,
  RateHistorySchema,
  RateVersionDtoSchema,
  SelectablePlanVersionsSchema,
  SelectableWorksitesSchema,
  type CostSnapshot,
  type CreateCostSnapshotCommand,
  type CreateRateVersionCommand,
  type EmployeesForRates,
  type PublishedPlanVersionsQuery,
  type RateHistory,
  type RateVersionDto,
  type SelectablePlanVersions,
  type SelectableWorksites,
} from "../costs/schemas.js";

export const ORGANISATION_HEADER = "X-EasyTree-Organization-Id";

export interface HttpCostsGatewayOptions {
  readonly fetchImpl: typeof fetch;
  /**
   * Liefert die AUSGEWÄHLTE Organisation oder null. Der Header wählt nur
   * aus — die Autorisierung entscheidet der Server gegen die Mitgliedschaft.
   */
  readonly organisationId: () => string | null;
}

interface Call<TOut> {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  readonly idempotencyKey: IdempotencyKey | null;
  readonly schema: z.ZodType<TOut>;
  readonly conflictAs: Extract<GatewayFailure, "REJECTED" | "STALE_VERSION">;
}

export class HttpCostsGateway implements CostsGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly options: HttpCostsGatewayOptions,
  ) {}

  listEmployees(): Promise<GatewayResult<EmployeesForRates>> {
    return this.send({
      path: "/kosten/mitarbeiter",
      method: "GET",
      idempotencyKey: null,
      schema: EmployeesForRatesSchema,
      conflictAs: "REJECTED",
    });
  }

  rateHistory(employeeId: string): Promise<GatewayResult<RateHistory>> {
    return this.send({
      path: `/kosten/stundensaetze/${encodeURIComponent(employeeId)}`,
      method: "GET",
      idempotencyKey: null,
      schema: RateHistorySchema,
      conflictAs: "REJECTED",
    });
  }

  createRateVersion(
    command: CreateRateVersionCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<RateVersionDto>> {
    const geprueft = CreateRateVersionCommandSchema.safeParse(command);
    if (!geprueft.success) {
      return Promise.resolve(gatewayFailed<RateVersionDto>("CONTRACT_VIOLATION", null));
    }
    return this.send({
      path: "/kosten/stundensaetze",
      method: "POST",
      body: geprueft.data,
      idempotencyKey: options.idempotencyKey,
      schema: RateVersionDtoSchema,
      // 409 heisst hier: konkurrierende Änderung erkannt (expectedActiveVersionId
      // stimmt nicht mehr) ODER Überlappung — der Server unterscheidet im
      // ProblemDocument; der Zustand für die UI ist in beiden Fällen "nicht
      // gespeichert, neu laden und entscheiden".
      conflictAs: "STALE_VERSION",
    });
  }

  publishedPlanVersions(
    query: PublishedPlanVersionsQuery,
  ): Promise<GatewayResult<SelectablePlanVersions>> {
    // Erst prüfen, dann senden — sonst wäre die Reihenfolgeregel des Schemas
    // (`fromWeekKey <= toWeekKey`) ein Kommentar.
    //
    // WAS DAS BRINGT: keine sinnlose Anfrage, keine irreführend leere Liste
    // (ein verkehrter Bereich sieht für den Server aus wie ein leerer), und ein
    // zweiter Riegel, der fail-closed schliesst.
    //
    // WAS DAS NICHT BRINGT: eine anzeigbare Meldung. Der Zweig gibt
    // `CONTRACT_VIOLATION` mit `problem: null` zurück — nicht unterscheidbar
    // von einer verstümmelten 200-Antwort, und die Meldung des `.refine()`
    // fällt dabei weg. Ein hier zusammengebautes `ProblemDocument` wäre eine
    // Lüge: `primitives.ts` definiert es als Spiegel der Serverantwort, eine
    // erfundene `correlationId` zeigte auf nichts. Die für den Menschen
    // lesbare Meldung gehört deshalb in das FORMULAR (EYT-109 Task 15), das
    // denselben `PublishedPlanVersionsQuerySchema` vor dem Absenden prüft und
    // dessen Fehlermeldung am Feld anzeigt. Wer die Oberfläche baut, darf
    // nicht darauf warten, dass das Gateway sie liefert.
    const geprueft = PublishedPlanVersionsQuerySchema.safeParse(query);
    if (!geprueft.success) {
      return Promise.resolve(gatewayFailed<SelectablePlanVersions>("CONTRACT_VIOLATION", null));
    }
    // `URLSearchParams` statt Zeichenkettenaddition: die Kodierung gehört nicht
    // in die Hand des Aufrufers, auch nicht bei heute harmlosen Werten.
    //
    // EHRLICH DAZU: kein gültiger Wochenschlüssel enthält ein Zeichen, das
    // maskiert werden müsste — eine Zeichenkettenaddition ergäbe heute dieselbe
    // URL, Byte für Byte. Diese Wahl ist deshalb NICHT durch einen Test
    // festgehalten, sondern ein Vorbau für den Tag, an dem hier ein Parameter
    // dazukommt, der maskiert werden muss. Wer sie rückgängig macht, wird von
    // keinem roten Test aufgehalten. Ein Testfall mit exotischer Eingabe wäre
    // kein Nachweis, sondern eine Prüfung eines Falls, den das Schema verbietet.
    const suche = new URLSearchParams({
      fromWeekKey: geprueft.data.fromWeekKey,
      toWeekKey: geprueft.data.toWeekKey,
    });
    return this.send({
      path: `/kosten/planversionen?${suche.toString()}`,
      method: "GET",
      idempotencyKey: null,
      schema: SelectablePlanVersionsSchema,
      // Wie beim Snapshot-Lesen: fachlich unmöglich, trotzdem entschieden und
      // im Test "bildet 409 auf BEIDEN Lesewegen auf REJECTED ab" festgehalten.
      conflictAs: "REJECTED",
    });
  }

  worksitesForPublishedPlanVersion(
    planVersionId: string,
  ): Promise<GatewayResult<SelectableWorksites>> {
    // Dieselbe lokale Prüfung wie bei `snapshot(...)` und aus demselben Grund:
    // der Wert kommt zwar aus der Auswahlliste, aber die Ansicht liest ihn aus
    // einem `<select>`, dessen Werte ein manipuliertes DOM setzen kann.
    // `encodeURIComponent` verhinderte das Ausbrechen aus dem Pfad, nicht die
    // Anfrage — und ein Ausbruchsversuch gehört gar nicht erst abgeschickt.
    const geprueft = IdSchema.safeParse(planVersionId);
    if (!geprueft.success) {
      return Promise.resolve(gatewayFailed<SelectableWorksites>("CONTRACT_VIOLATION", null));
    }
    return this.send({
      path: `/kosten/planversionen/${encodeURIComponent(geprueft.data)}/baustellen`,
      method: "GET",
      idempotencyKey: null,
      schema: SelectableWorksitesSchema,
      // Wie auf den beiden anderen Lesewegen: ein GET erzeugt fachlich keinen
      // Konflikt. Käme doch eine 409 an, ist REJECTED die ehrliche Antwort —
      // es gibt hier keinen Stand des Clients, der veralten könnte.
      conflictAs: "REJECTED",
    });
  }

  createSnapshot(
    command: CreateCostSnapshotCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<CostSnapshot>> {
    const geprueft = CreateCostSnapshotCommandSchema.safeParse(command);
    if (!geprueft.success) {
      return Promise.resolve(gatewayFailed<CostSnapshot>("CONTRACT_VIOLATION", null));
    }
    return this.send({
      path: "/kosten/snapshots",
      method: "POST",
      body: geprueft.data,
      idempotencyKey: options.idempotencyKey,
      schema: CostSnapshotSchema,
      // REJECTED, nicht STALE_VERSION — anders als bei `createRateVersion`.
      //
      // Der Unterschied ist die Handlung, die der Mensch danach vornehmen muss.
      // Dort heisst 409 „jemand hat die aktive Version unter dir geändert":
      // neu laden und NEU ENTSCHEIDEN. Hier gibt es keinen Stand, der veralten
      // könnte — ein Snapshot ist unveränderlich und wird nur angelegt. Die
      // einzige 409 dieser Route ist ein wiederverwendeter Idempotenzschlüssel
      // mit abweichender Nutzlast, also ein Aufruferfehler, der mit einem
      // frischen Schlüssel behoben ist. Als STALE_VERSION gemeldet, schickte er
      // den Nutzer in einen Neu-laden-Dialog, der nichts ändert.
      conflictAs: "REJECTED",
    });
  }

  snapshot(snapshotId: string): Promise<GatewayResult<CostSnapshot>> {
    // Auch der nackte String wird geprüft, nicht nur die schemagetippten
    // Objekte. Der Wert kommt in Task 15 als `params.id` unmittelbar aus der
    // Adresszeile — ohne diese Zeile trüge jede vertippte URL eine beliebige
    // Zeichenkette in einen Serverpfad. `encodeURIComponent` verhindert das
    // Ausbrechen aus dem Pfad, aber nicht die Anfrage; ein Ausbruchsversuch
    // gehört gar nicht erst abgeschickt.
    //
    // Damit wird `rateHistory` oben zum Ausreisser: derselbe Fall, ungeprüft.
    // Das gehört ebenfalls geprüft — aber es ist EYT-108er Code, und ihn in
    // diesem Slice mitzuändern hiesse, eine fremde Zusicherung ohne eigenen
    // Test zu verschieben. Als Nachzug notiert, nicht still erledigt.
    const geprueft = IdSchema.safeParse(snapshotId);
    if (!geprueft.success) {
      return Promise.resolve(gatewayFailed<CostSnapshot>("CONTRACT_VIOLATION", null));
    }
    return this.send({
      // Nach der Prüfung kann kein gültiger Bezeichner mehr ein Zeichen
      // enthalten, das maskiert werden müsste — `encodeURIComponent` ist ab
      // hier Gürtel zum Hosenträger und durch keinen Test festgehalten, genau
      // wie `URLSearchParams` oben.
      path: `/kosten/snapshots/${encodeURIComponent(geprueft.data)}`,
      method: "GET",
      idempotencyKey: null,
      schema: CostSnapshotSchema,
      // Ein GET erzeugt fachlich keinen Konflikt; `Call` verlangt das Feld
      // trotzdem. Kommt doch eine 409 an — Proxy, Fehlkonfiguration, späterer
      // Server —, ist REJECTED die ehrliche Antwort: es gibt hier keinen Stand
      // des Clients, der veralten könnte. Der Test "bildet 409 auf BEIDEN
      // Lesewegen auf REJECTED ab" hält das fest; ohne ihn wäre dieser Kommentar
      // eine unbelegte Behauptung.
      conflictAs: "REJECTED",
    });
  }

  private async send<TOut>(call: Call<TOut>): Promise<GatewayResult<TOut>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (call.body !== undefined) headers["content-type"] = "application/json";

    const organisation = this.options.organisationId();
    if (organisation !== null) headers[ORGANISATION_HEADER] = organisation;

    if (call.idempotencyKey !== null) {
      const key = IdempotencyKeySchema.safeParse(call.idempotencyKey);
      if (!key.success) return gatewayFailed<TOut>("CONTRACT_VIOLATION", null);
      headers[IDEMPOTENCY_HEADER] = key.data;
    }

    let response: Response;
    try {
      response = await this.options.fetchImpl(`${this.baseUrl}${call.path}`, {
        method: call.method,
        headers,
        credentials: "same-origin",
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      });
    } catch {
      return gatewayFailed<TOut>("UNAVAILABLE", null);
    }

    if (!response.ok) {
      const problem = await readProblem(response);
      if (response.status === 401) return gatewayFailed<TOut>("UNAUTHENTICATED", problem);
      if (response.status === 403) return gatewayFailed<TOut>("FORBIDDEN", problem);
      if (response.status === 409) return gatewayFailed<TOut>(call.conflictAs, problem);
      if (response.status >= 500) return gatewayFailed<TOut>("UNAVAILABLE", problem);
      return gatewayFailed<TOut>("REJECTED", problem);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return gatewayFailed<TOut>("CONTRACT_VIOLATION", null);
    }
    const parsed = call.schema.safeParse(payload);
    if (!parsed.success) return gatewayFailed<TOut>("CONTRACT_VIOLATION", null);
    return gatewayOk(parsed.data);
  }
}

async function readProblem(response: Response): Promise<ProblemDocument | null> {
  try {
    const parsed = ProblemDocumentSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
