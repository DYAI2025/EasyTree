/**
 * Der Kosten-Client haelt sich an den Port (EYT-109).
 *
 * Der wichtigste Fall steht zuerst, wie im Nachbartest
 * `http-planning-gateway.test.ts`: eine Antwort mit HTTP 200, die NICHT dem
 * Schema entspricht, darf nicht durchgereicht werden. Bei einem Snapshot waere
 * das besonders teuer — ein `totalMinorUnits` als JSON-Zahl saehe in der
 * Oberflaeche aus wie ein Betrag, haette oberhalb von 2^53 aber still Stellen
 * verloren. Lieber eine abgelehnte Antwort als eine falsche Zahl.
 *
 * Die zweite Zusicherung ist LOKAL: Kommando, Wochenbereich und Snapshot-Id
 * werden VOR dem Absenden gegen ihr Schema geprueft. Ohne diese Pruefung faende
 * der Fehler erst im Server statt, und die Refine-Regel in
 * `PublishedPlanVersionsQuerySchema` ("from <= to") waere ein Kommentar. Jeder
 * Negativfall hat darum seinen Positivfall daneben — sonst waere ein Client,
 * der ALLES verwirft, gruen.
 *
 * ## EHRLICH DAZU: dies deckt VIER der sechs Portmethoden ab
 *
 * Die Blockueberschriften nennen `HttpCostsGateway`, gemeint sind aber nur
 * `publishedPlanVersions`, `createSnapshot`, `snapshot` und — an einer Stelle,
 * zum Vergleich der 409-Bedeutung — `createRateVersion`. Fuer `listEmployees`
 * und `rateHistory` gibt es HTTP-seitig nirgends im Projekt einen Test; sie
 * kamen mit EYT-108 und blieben ungedeckt. Das ist hier bewusst nicht
 * nachgeholt (ausserhalb des Auftrags von EYT-109), steht aber hier, damit
 * niemand aus dem Dateinamen schliesst, die Klasse sei vollstaendig geprueft.
 * Wer die Luecke schliesst, streicht diesen Absatz.
 */
import { describe, expect, it } from "vitest";

import {
  HttpCostsGateway,
  ORGANISATION_HEADER,
  type HttpCostsGatewayOptions,
} from "../src/http/costs-gateway.js";
import type { CreateCostSnapshotCommand } from "../src/costs/schemas.js";
import { IDEMPOTENCY_HEADER, newIdempotencyKey, type IdempotencyKey } from "../src/primitives.js";

const BASE = "https://api.example.test/api/v1";
const ORG = "00000000-0000-4000-8000-0000000000a1";

const SNAPSHOT_ID = "3f1c9c2a-5b7e-4d21-9f0a-8c6e2b1d4a77";
const PLAN_VERSION_ID = "9a2b7c1d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const POSITION_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const ASSIGNMENT_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const WORKSITE_ID = "7e8f9a0b-1c2d-4e3f-a4b5-c6d7e8f9a0b1";
const EMPLOYEE_ID = "5d6e7f80-9a1b-4c2d-b3e4-f5061728394a";
const RATE_VERSION_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f60718293";
const USER_ID = "8c9d0e1f-2a3b-4c5d-9e6f-708192a3b4c5";

/** Der Typ, den der Client wirklich verlangt — kein eigener `FetchLike`-Nachbau. */
type CostsFetch = HttpCostsGatewayOptions["fetchImpl"];

interface Recorded {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** Fetch-Attrappe, die eine feste Antwort liefert und den Aufruf mitschreibt. */
function stubFetch(status: number, payload: unknown, recorded: Recorded[]): CostsFetch {
  return (url, init) => {
    recorded.push({ url: String(url), init });
    return Promise.resolve(
      new Response(payload === undefined ? null : JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

function gatewayWith(
  fetchImpl: CostsFetch,
  organisationId: () => string | null = () => ORG,
): HttpCostsGateway {
  return new HttpCostsGateway(BASE, { fetchImpl, organisationId });
}

function headersOf(recorded: Recorded | undefined): Record<string, string> {
  return (recorded?.init?.headers ?? {}) as Record<string, string>;
}

const PROBLEM = (status: number) => ({
  type: "about:blank",
  title: "Fehler",
  status,
  detail: "d",
  correlationId: "c",
});

/** Eine vollstaendige, vertragskonforme Snapshot-Antwort. */
const SNAPSHOT = {
  id: SNAPSHOT_ID,
  planVersionId: PLAN_VERSION_ID,
  worksiteId: null,
  weekKey: "2026-W32",
  timeZone: "Europe/Berlin",
  currency: "EUR",
  ruleVersion: "personnel-plan-cost-v1",
  createdAt: "2026-08-08T10:00:00.000Z",
  createdBy: USER_ID,
  correlationId: "abc",
  totalMinorUnits: "12000",
  days: [{ localDate: "2026-08-03", amountMinorUnits: "12000" }],
  positions: [
    {
      id: POSITION_ID,
      assignmentId: ASSIGNMENT_ID,
      worksiteId: WORKSITE_ID,
      worksiteLabel: "Baustelle Nord",
      employeeId: EMPLOYEE_ID,
      employeeLabel: "Mira Baumgart",
      localDate: "2026-08-03",
      durationMilliseconds: "28800000",
      rateVersionId: RATE_VERSION_ID,
      amountMinorUnits: "12000",
    },
  ],
};

/** Eine vollstaendige, vertragskonforme Auswahlliste. */
const VERSIONS = {
  versions: [{ id: PLAN_VERSION_ID, weekKey: "2026-W32", publishedAt: "2026-07-31T12:00:00.000Z" }],
};

const COMMAND: CreateCostSnapshotCommand = {
  publishedPlanVersionId: PLAN_VERSION_ID,
  worksiteId: null,
};

describe("HttpCostsGateway — Antwortpruefung", () => {
  it("liefert den gespeicherten Snapshot, wenn die Antwort dem Vertrag entspricht", async () => {
    const result = await gatewayWith(stubFetch(200, SNAPSHOT, [])).snapshot(SNAPSHOT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(SNAPSHOT_ID);
    expect(result.value.totalMinorUnits).toBe("12000");
    expect(result.value.positions).toHaveLength(1);
  });

  it("vertraut einem Snapshot mit Betrag als JSON-Zahl NICHT", async () => {
    // Plausibel bis auf ein Feld: `totalMinorUnits` als Zahl statt als
    // Ziffernfolge. Genau der Fall, gegen den `MinorUnitsSchema` existiert —
    // ein Float verliert oberhalb von 2^53 still Stellen. Durchgereicht waere
    // das ein falscher Betrag in der Oberflaeche, keine Fehlermeldung.
    const kaputt = { ...SNAPSHOT, totalMinorUnits: 12000 };
    const result = await gatewayWith(stubFetch(200, kaputt, [])).snapshot(SNAPSHOT_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("CONTRACT_VIOLATION");
  });

  it("vertraut einer Auswahlliste mit unkanonischem Zeitpunkt NICHT", async () => {
    // Ein halb ausgerollter Server, der die Millisekunden weglaesst. Sieht
    // richtig aus, ist es nicht — `InstantSchema` verlangt die kanonische Form.
    const kaputt = {
      versions: [{ id: PLAN_VERSION_ID, weekKey: "2026-W32", publishedAt: "2026-07-31T12:00:00Z" }],
    };
    const result = await gatewayWith(stubFetch(200, kaputt, [])).publishedPlanVersions({
      fromWeekKey: "2026-W30",
      toWeekKey: "2026-W32",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("CONTRACT_VIOLATION");
  });

  it("liefert die Auswahlliste, wenn die Antwort dem Vertrag entspricht", async () => {
    // Gegenprobe: ohne sie waere die Ablehnung oben auch dann gruen, wenn der
    // Client JEDE Auswahlliste verwuerfe.
    const result = await gatewayWith(stubFetch(200, VERSIONS, [])).publishedPlanVersions({
      fromWeekKey: "2026-W30",
      toWeekKey: "2026-W32",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versions).toHaveLength(1);
    expect(result.value.versions[0]?.weekKey).toBe("2026-W32");
  });

  it("prueft auch die 201-Antwort des Schreibens gegen das Schema", async () => {
    // Der Schreibpfad hat keinen eigenen Vertrauensvorschuss: `days` ohne den
    // Tag, an dem Positionen liegen, ist strukturell unbrauchbar — die
    // Oberflaeche muesste selbst summieren (siehe `CostSnapshotSchema`).
    const kaputt = { ...SNAPSHOT, days: [] };
    const result = await gatewayWith(stubFetch(201, kaputt, [])).createSnapshot(COMMAND, {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("CONTRACT_VIOLATION");
  });

  it("nimmt eine vertragskonforme 201-Antwort an", async () => {
    // Gegenprobe zur Zeile darueber.
    const result = await gatewayWith(stubFetch(201, SNAPSHOT, [])).createSnapshot(COMMAND, {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(result.ok).toBe(true);
  });

  it("vertraut auch einer 200-Antwort ohne JSON nicht", async () => {
    const result = await gatewayWith(() =>
      Promise.resolve(new Response("<html>Gateway</html>", { status: 200 })),
    ).snapshot(SNAPSHOT_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("CONTRACT_VIOLATION");
  });
});

describe("HttpCostsGateway — Aufrufform", () => {
  it("liest einen Snapshot ueber seinen Pfad, ohne Koerper und ohne Schluessel", async () => {
    const recorded: Recorded[] = [];
    await gatewayWith(stubFetch(200, SNAPSHOT, recorded)).snapshot(SNAPSHOT_ID);
    expect(recorded[0]?.url).toBe(`${BASE}/kosten/snapshots/${SNAPSHOT_ID}`);
    expect(recorded[0]?.init?.method).toBe("GET");
    expect(recorded[0]?.init?.body).toBeUndefined();
    // Ein Lesevorgang entsteht nicht zweimal; ein Schluessel taeuschte Bedeutung vor.
    expect(headersOf(recorded[0])[IDEMPOTENCY_HEADER]).toBeUndefined();
    // Die Sitzung reist im HttpOnly-Cookie. Ohne diese Zeile im Client waere
    // JEDE Kostenanfrage anonym und der Server antwortete durchgehend 401 —
    // und kein anderer Test haette es bemerkt (im Review gemessen: geloescht,
    // 182 gruen).
    expect(recorded[0]?.init?.credentials).toBe("same-origin");
    expect(headersOf(recorded[0])["accept"]).toBe("application/json");
  });

  it("lehnt eine Snapshot-Id ab, die kein Bezeichner ist, statt sie zu senden", async () => {
    // In Task 15 kommt dieser Wert als `params.id` direkt aus der Adresszeile.
    // `encodeURIComponent` verhindert nur das AUSBRECHEN aus dem Pfad, nicht
    // die Anfrage: vor der lokalen Pruefung ging `../mitarbeiter` als
    // `..%2Fmitarbeiter` tatsaechlich hinaus. Ein Ausbruchsversuch gehoert gar
    // nicht erst abgeschickt.
    const recorded: Recorded[] = [];
    const gateway = gatewayWith(stubFetch(200, SNAPSHOT, recorded));

    for (const bad of ["", "../mitarbeiter", "nicht-uuid", `${SNAPSHOT_ID} `]) {
      const result = await gateway.snapshot(bad);
      expect(result.ok, bad).toBe(false);
      if (result.ok) continue;
      expect(result.failure, bad).toBe("CONTRACT_VIOLATION");
    }
    expect(recorded).toHaveLength(0);
  });

  it("laesst einen gueltigen Bezeichner unveraendert durch", async () => {
    // Gegenprobe: ohne sie waere die Ablehnung oben auch dann gruen, wenn der
    // Client JEDE Id verwuerfe und das Lesen nie funktionierte.
    const recorded: Recorded[] = [];
    const result = await gatewayWith(stubFetch(200, SNAPSHOT, recorded)).snapshot(SNAPSHOT_ID);
    expect(result.ok).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.url).toBe(`${BASE}/kosten/snapshots/${SNAPSHOT_ID}`);
  });

  it("haengt den Wochenbereich an die URL und nicht in den Koerper", async () => {
    const recorded: Recorded[] = [];
    await gatewayWith(stubFetch(200, VERSIONS, recorded)).publishedPlanVersions({
      fromWeekKey: "2026-W30",
      toWeekKey: "2026-W32",
    });
    expect(recorded[0]?.url).toBe(
      `${BASE}/kosten/planversionen?fromWeekKey=2026-W30&toWeekKey=2026-W32`,
    );
    expect(recorded[0]?.init?.method).toBe("GET");
    expect(recorded[0]?.init?.body).toBeUndefined();
  });

  it("schreibt den Snapshot per POST mit Kommando und Idempotenzschluessel", async () => {
    const recorded: Recorded[] = [];
    const key = newIdempotencyKey();
    const result = await gatewayWith(stubFetch(201, SNAPSHOT, recorded)).createSnapshot(COMMAND, {
      idempotencyKey: key,
    });
    expect(result.ok).toBe(true);
    expect(recorded[0]?.url).toBe(`${BASE}/kosten/snapshots`);
    expect(recorded[0]?.init?.method).toBe("POST");
    // Ueber den geparsten Wert, nicht ueber die Zeichenkette: ein Byte-Vergleich
    // haette nur gehalten, weil die Schluesselreihenfolge des Literals zufaellig
    // der Schemaform entspricht.
    expect(JSON.parse(String(recorded[0]?.init?.body))).toEqual(COMMAND);
    expect(headersOf(recorded[0])[IDEMPOTENCY_HEADER]).toBe(key);
    expect(recorded[0]?.init?.credentials).toBe("same-origin");
    expect(headersOf(recorded[0])["content-type"]).toBe("application/json");
  });

  it("lehnt einen formal ungueltigen Idempotenzschluessel ab, statt ihn zu senden", async () => {
    // Der Brand haelt nur die Typebene; ein `as` beim Aufrufer umgeht ihn. Ein
    // leerer Header waere fuer den Server nicht von gar keinem zu unterscheiden
    // — die Wiederholungserkennung fiele still aus, und ein Retry schriebe
    // einen ZWEITEN Snapshot.
    const recorded: Recorded[] = [];
    const gateway = gatewayWith(stubFetch(201, SNAPSHOT, recorded));

    for (const bad of ["", "kurz", "hat leerzeichen", "unerlaubt/zeichen"]) {
      const result = await gateway.createSnapshot(COMMAND, {
        idempotencyKey: bad as unknown as IdempotencyKey,
      });
      expect(result.ok, bad).toBe(false);
      if (result.ok) continue;
      expect(result.failure, bad).toBe("CONTRACT_VIOLATION");
    }

    // Und es ging wirklich nichts hinaus.
    expect(recorded).toHaveLength(0);
  });

  it("prueft das Kommando lokal, statt ein Fremdfeld ueber die Leitung zu schicken", async () => {
    // `organisationId` im Rumpf waere ein Mandantenwechsel per Nutzlast. Der
    // Header WAEHLT aus, der Server autorisiert — ein Feld im Kommando gehoert
    // in keine der beiden Rollen und darf nicht einmal abgesendet werden.
    const recorded: Recorded[] = [];
    const result = await gatewayWith(stubFetch(201, SNAPSHOT, recorded)).createSnapshot(
      {
        publishedPlanVersionId: PLAN_VERSION_ID,
        worksiteId: null,
        organisationId: ORG,
      } as unknown as CreateCostSnapshotCommand,
      { idempotencyKey: newIdempotencyKey() },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("CONTRACT_VIOLATION");
    expect(recorded).toHaveLength(0);
  });

  it("lehnt einen verkehrten Wochenbereich lokal ab, statt ihn abzuschicken", async () => {
    // Die Reihenfolgeregel steht im Schema (`fromWeekKey <= toWeekKey`). Wenn
    // der Client sie nicht ausfuehrt, ist sie ein Kommentar: der Server saehe
    // einen leeren Bereich und antwortete mit einer leeren Liste — die
    // Oberflaeche zeigte "keine Planversionen" statt eines Eingabefehlers.
    const recorded: Recorded[] = [];
    const result = await gatewayWith(stubFetch(200, VERSIONS, recorded)).publishedPlanVersions({
      fromWeekKey: "2026-W32",
      toWeekKey: "2026-W30",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("CONTRACT_VIOLATION");
    expect(recorded).toHaveLength(0);
  });

  it("laesst eine einzelne Woche als Bereich durch", async () => {
    // Gegenprobe: `<=`, nicht `<`. Ohne diesen Fall waere die Ablehnung oben
    // auch dann gruen, wenn der Client jeden Bereich mit gleichem Anfang und
    // Ende verwuerfe — und die Auswahl EINER Woche waere unbenutzbar.
    const recorded: Recorded[] = [];
    const result = await gatewayWith(stubFetch(200, VERSIONS, recorded)).publishedPlanVersions({
      fromWeekKey: "2026-W32",
      toWeekKey: "2026-W32",
    });
    expect(result.ok).toBe(true);
    expect(recorded).toHaveLength(1);
  });

  it("sendet den Organisationsheader aus der injizierten Quelle", async () => {
    const recorded: Recorded[] = [];
    await gatewayWith(stubFetch(200, SNAPSHOT, recorded), () => ORG).snapshot(SNAPSHOT_ID);
    expect(headersOf(recorded[0])[ORGANISATION_HEADER]).toBe(ORG);
  });

  it("baut sich ohne Quelle keinen Organisationsheader zusammen", async () => {
    // Gegenprobe: null heisst "keine Organisation gewaehlt". Ein erfundener
    // oder leerer Header waere eine stille Auswahl.
    const recorded: Recorded[] = [];
    await gatewayWith(stubFetch(200, SNAPSHOT, recorded), () => null).snapshot(SNAPSHOT_ID);
    expect(headersOf(recorded[0])).not.toHaveProperty(ORGANISATION_HEADER);
  });
});

describe("HttpCostsGateway — Fehlerzustaende", () => {
  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [500, "UNAVAILABLE"],
    [422, "REJECTED"],
  ])("bildet HTTP %i beim Snapshot-Lesen auf %s ab", async (status, failure) => {
    const result = await gatewayWith(stubFetch(status, PROBLEM(status), [])).snapshot(SNAPSHOT_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe(failure);
  });

  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [500, "UNAVAILABLE"],
  ])("bildet HTTP %i beim Snapshot-Schreiben auf %s ab", async (status, failure) => {
    const result = await gatewayWith(stubFetch(status, PROBLEM(status), [])).createSnapshot(
      COMMAND,
      { idempotencyKey: newIdempotencyKey() },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe(failure);
  });

  it("bildet 409 auf BEIDEN Lesewegen auf REJECTED ab", async () => {
    // Ein GET erzeugt fachlich keinen Konflikt — trotzdem ist `conflictAs` auf
    // beiden Lesewegen eine ENTSCHEIDUNG, und eine Entscheidung, die einen
    // Kommentar wert ist, ist einen Test wert. Ohne diesen Fall blieb die
    // Zusicherung unbelegt: beide Werte liessen sich auf STALE_VERSION drehen,
    // ohne dass ein einziger Test rot wurde (gemessen im Review).
    //
    // Passiert es doch — ein Proxy, eine Fehlkonfiguration, ein spaeterer
    // Server —, dann ist REJECTED die ehrliche Antwort: es gibt hier keinen
    // Stand des Clients, der veraltet sein koennte, also gibt es auch nichts
    // neu zu entscheiden.
    const problem = PROBLEM(409);

    const snapshot = await gatewayWith(stubFetch(409, problem, [])).snapshot(SNAPSHOT_ID);
    expect(snapshot.ok).toBe(false);
    if (snapshot.ok) return;
    expect(snapshot.failure).toBe("REJECTED");

    const liste = await gatewayWith(stubFetch(409, problem, [])).publishedPlanVersions({
      fromWeekKey: "2026-W30",
      toWeekKey: "2026-W32",
    });
    expect(liste.ok).toBe(false);
    if (liste.ok) return;
    expect(liste.failure).toBe("REJECTED");
  });

  it("macht aus einem Netzwerkfehler UNAVAILABLE ohne ProblemDocument", async () => {
    const result = await gatewayWith(() => Promise.reject(new Error("ECONNREFUSED"))).snapshot(
      SNAPSHOT_ID,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("UNAVAILABLE");
    expect(result.problem).toBeNull();
  });

  it("unterscheidet 409 nach Aufruf: Snapshot ist REJECTED, Satzversion STALE_VERSION", async () => {
    // Derselbe Statuscode, zwei Bedeutungen, zwei Handlungen fuer den Menschen.
    //
    // Beim Snapshot kann 409 nur aus einem wiederverwendeten Idempotenzschluessel
    // mit anderer Nutzlast entstehen — ein Aufruferfehler, behoben durch einen
    // frischen Schluessel. Beim Satz heisst 409 "jemand hat unter dir geaendert":
    // neu laden und NEU ENTSCHEIDEN. Wer beides auf STALE_VERSION einebnet,
    // schickt den Nutzer beim Snapshot in einen Neu-laden-Dialog, der nichts hilft.
    const problem = PROBLEM(409);

    const snapshot = await gatewayWith(stubFetch(409, problem, [])).createSnapshot(COMMAND, {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(snapshot.ok).toBe(false);
    if (snapshot.ok) return;
    expect(snapshot.failure).toBe("REJECTED");

    const rate = await gatewayWith(stubFetch(409, problem, [])).createRateVersion(
      {
        employeeId: EMPLOYEE_ID,
        amountMinorUnits: "4200",
        currency: "EUR",
        validFrom: "2026-07-01",
        validTo: null,
        reason: "Tariferhoehung",
        expectedActiveVersionId: null,
      },
      { idempotencyKey: newIdempotencyKey() },
    );
    expect(rate.ok).toBe(false);
    if (rate.ok) return;
    expect(rate.failure).toBe("STALE_VERSION");
  });

  it("reicht das ProblemDocument des Snapshot-Schreibens durch", async () => {
    const result = await gatewayWith(
      stubFetch(422, { ...PROBLEM(422), title: "Planversion nicht veroeffentlicht" }, []),
    ).createSnapshot(COMMAND, { idempotencyKey: newIdempotencyKey() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem?.title).toBe("Planversion nicht veroeffentlicht");
  });
});
