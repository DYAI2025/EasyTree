/**
 * Der vertragsabgeleitete Client haelt sich an den Port (EYT-50 AK3).
 *
 * Der wichtigste Fall steht zuerst: eine Antwort mit HTTP 200, die NICHT dem
 * Schema entspricht, darf nicht durchgereicht werden. Ohne diese Pruefung
 * wandert sie als `PlanningWindow` durch die UI und faellt erst tief drin auf —
 * an einer Stelle, die mit der Ursache nichts zu tun hat.
 */
import { describe, expect, it } from "vitest";

import { HttpPlanningGateway, type FetchLike } from "../src/http/planning-gateway.js";
import {
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
  newIdempotencyKey,
  type IdempotencyKey,
} from "../src/primitives.js";

const BASE = "https://api.example.test/api/v1";

interface Recorded {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** Fetch-Attrappe, die eine feste Antwort liefert und den Aufruf mitschreibt. */
function stubFetch(status: number, payload: unknown, recorded: Recorded[]): FetchLike {
  return (url, init) => {
    recorded.push({ url, init });
    return Promise.resolve(
      new Response(payload === undefined ? null : JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

function gatewayWith(fetchImpl: FetchLike): HttpPlanningGateway {
  return new HttpPlanningGateway({
    baseUrl: BASE,
    fetchImpl,
    authorization: () => "Bearer testtoken",
  });
}

// Durch das Schema, nicht per Cast — sonst umginge der Test genau die
// Pruefung, die er absichern soll.
const KEY_A = IdempotencyKeySchema.parse("11111111-1111-4111-8111-111111111111");

const DRAFT = {
  weekKey: "2026-W32",
  employeeId: "00000000-0000-0000-0000-0000004010a1",
  worksiteId: "00000000-0000-0000-0000-0000005010a1",
  interval: { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T14:00:00.000Z" },
} as const;

const PUBLISHED = {
  versionId: "22222222-2222-4222-8222-222222222222",
  weekKey: "2026-W32",
  publishedAtUtc: "2026-07-31T12:00:00.000Z",
  assignmentIds: [],
};

const VALID_WINDOW = {
  weekKey: "2026-W32",
  timeZone: "Europe/Berlin",
  assignments: [],
  sourceVersion: null,
  publishedVersionId: null,
  resources: { employees: [], worksites: [] },
};

describe("HttpPlanningGateway — Antwortpruefung", () => {
  it("liefert das Fenster, wenn die Antwort dem Vertrag entspricht", async () => {
    const gateway = gatewayWith(stubFetch(200, VALID_WINDOW, []));
    const result = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.weekKey).toBe("2026-W32");
    expect(result.value.timeZone).toBe("Europe/Berlin");
  });

  it("vertraut einer formal falschen 200-Antwort NICHT", async () => {
    // Ein aelterer Server, ein Proxy mit Fehlerseite, ein halb ausgerollter
    // Stand: in allen drei Faellen kommt etwas an, das wie JSON aussieht.
    const gateway = gatewayWith(stubFetch(200, { weekKey: "2026-W32" }, []));
    const result = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("CONTRACT_VIOLATION");
  });

  it("vertraut auch einer 200-Antwort ohne JSON nicht", async () => {
    const gateway = gatewayWith(() =>
      Promise.resolve(new Response("<html>Gateway</html>", { status: 200 })),
    );
    const result = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("CONTRACT_VIOLATION");
  });
});

describe("HttpPlanningGateway — Fehlerzustaende", () => {
  it("macht aus einem Netzwerkfehler UNAVAILABLE ohne ProblemDocument", async () => {
    const gateway = gatewayWith(() => Promise.reject(new Error("ECONNREFUSED")));
    const result = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("UNAVAILABLE");
    // Es kam nichts an, also gibt es auch nichts zu zeigen.
    expect(result.problem).toBeNull();
  });

  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [500, "UNAVAILABLE"],
    [422, "REJECTED"],
  ])("bildet HTTP %i auf %s ab", async (status, failure) => {
    const gateway = gatewayWith(
      stubFetch(
        status,
        { type: "about:blank", title: "Fehler", status, detail: "d", correlationId: "c" },
        [],
      ),
    );
    const result = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe(failure);
  });

  it("unterscheidet 409 nach Aufruf: Veroeffentlichen ist STALE_VERSION", async () => {
    // Derselbe Statuscode, zwei Bedeutungen. Die UI muss auf einen veralteten
    // Stand anders reagieren als auf eine fachliche Ablehnung — deshalb darf
    // der Client das nicht einebnen.
    const problem = {
      type: "about:blank",
      title: "Konflikt",
      status: 409,
      detail: "d",
      correlationId: "c",
    };
    const publish = await gatewayWith(stubFetch(409, problem, [])).publishPlan(
      { weekKey: "2026-W32", expectedVersionId: null },
      { idempotencyKey: KEY_A },
    );
    expect(publish.ok).toBe(false);
    if (publish.ok) return;
    expect(publish.failure).toBe("STALE_VERSION");

    const create = await gatewayWith(stubFetch(409, problem, [])).createAssignment(DRAFT, {
      idempotencyKey: KEY_A,
    });
    expect(create.ok).toBe(false);
    if (create.ok) return;
    expect(create.failure).toBe("REJECTED");
  });

  it("reicht das ProblemDocument durch, wenn eines kam", async () => {
    const gateway = gatewayWith(
      stubFetch(
        422,
        {
          type: "about:blank",
          title: "Ueberschneidung",
          status: 422,
          detail: "Person ist bereits verplant",
          correlationId: "c",
        },
        [],
      ),
    );
    const result = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem?.title).toBe("Ueberschneidung");
  });

  it("macht aus einer unlesbaren Fehlerantwort keinen zweiten Fehler", async () => {
    // Der Fehlerzustand steht schon fest; das Dokument ist Zusatzinformation.
    const gateway = gatewayWith(() => Promise.resolve(new Response("kaputt", { status: 403 })));
    const result = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("FORBIDDEN");
    expect(result.problem).toBeNull();
  });
});

describe("HttpPlanningGateway — Aufrufform", () => {
  it("traegt bei ZWEI Aufrufen desselben Vorgangs exakt denselben Schluessel", async () => {
    // Die Fehlerkette, gegen die der Schluessel schuetzt, wird hier gefahren:
    //   1. Server committet den Publish.
    //   2. Die Antwort geht verloren.
    //   3. Der Aufrufer wiederholt.
    // Bekaeme die Wiederholung einen NEUEN Schluessel, saehe der Server zwei
    // Vorgaenge — der Doppeleffekt traete genau dann ein, wenn der Schluessel
    // ihn verhindern soll.
    const recorded: Recorded[] = [];
    let firstCall = true;
    const flaky: FetchLike = (url, init) => {
      recorded.push({ url, init });
      if (firstCall) {
        firstCall = false;
        // Antwort verloren — der Server hat aber committet.
        return Promise.reject(new Error("socket hang up"));
      }
      return Promise.resolve(
        new Response(JSON.stringify(PUBLISHED), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };

    // EIN fachlicher Vorgang, EIN Schluessel — vom Aufrufer gehalten.
    const vorgang = { idempotencyKey: newIdempotencyKey() };
    const gateway = gatewayWith(flaky);
    const command = { weekKey: "2026-W32", expectedVersionId: null } as const;

    const first = await gateway.publishPlan(command, vorgang);
    expect(first.ok).toBe(false);
    const second = await gateway.publishPlan(command, vorgang);
    expect(second.ok).toBe(true);

    expect(recorded).toHaveLength(2);
    const keys = recorded.map(
      (r) => (r.init?.headers as Record<string, string>)[IDEMPOTENCY_HEADER],
    );
    expect(keys[0]).toBe(vorgang.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
  });

  it("gibt einem NEUEN Vorgang einen anderen Schluessel", async () => {
    // Gegenprobe: ohne sie waere die Zusicherung oben auch dann gruen, wenn
    // ueberall derselbe konstante Schluessel stuende — genau der Fehler, den
    // die erste Fassung dieses Tests hatte.
    const recorded: Recorded[] = [];
    const gateway = gatewayWith(stubFetch(200, PUBLISHED, recorded));
    const command = { weekKey: "2026-W32", expectedVersionId: null } as const;

    await gateway.publishPlan(command, { idempotencyKey: newIdempotencyKey() });
    await gateway.publishPlan(command, { idempotencyKey: newIdempotencyKey() });

    const keys = recorded.map(
      (r) => (r.init?.headers as Record<string, string>)[IDEMPOTENCY_HEADER],
    );
    expect(keys[0]).toBeDefined();
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("lehnt einen formal ungueltigen Schluessel ab, statt ihn zu senden", async () => {
    // Der Brand haelt Typebene; ein `as` beim Aufrufer umgeht ihn. Fuer den
    // Server waere ein leerer Header nicht von gar keinem zu unterscheiden —
    // die Wiederholungserkennung fiele still aus. Der Fehler gehoert dorthin,
    // wo er benannt werden kann.
    const recorded: Recorded[] = [];
    const gateway = gatewayWith(stubFetch(200, PUBLISHED, recorded));

    for (const bad of ["", "kurz", "hat leerzeichen", "unerlaubt/zeichen"]) {
      const result = await gateway.publishPlan(
        { weekKey: "2026-W32", expectedVersionId: null },
        { idempotencyKey: bad as unknown as IdempotencyKey },
      );
      expect(result.ok, bad).toBe(false);
      if (result.ok) continue;
      expect(result.failure, bad).toBe("CONTRACT_VIOLATION");
    }

    // Und es ging wirklich nichts hinaus: ein abgelehnter Schluessel darf den
    // Server gar nicht erst erreichen.
    expect(recorded).toHaveLength(0);
  });

  it("laesst einen gueltigen Schluessel unveraendert durch", async () => {
    // Gegenprobe: ohne sie waere die Ablehnung oben auch dann gruen, wenn der
    // Client JEDEN Schluessel verwuerfe.
    const recorded: Recorded[] = [];
    const key = newIdempotencyKey();
    const result = await gatewayWith(stubFetch(200, PUBLISHED, recorded)).publishPlan(
      { weekKey: "2026-W32", expectedVersionId: null },
      { idempotencyKey: key },
    );
    expect(result.ok).toBe(true);
    expect((recorded[0]?.init?.headers as Record<string, string>)[IDEMPOTENCY_HEADER]).toBe(key);
  });

  it("sendet bei lesenden Aufrufen keinen Schluessel", async () => {
    // Dort entsteht nichts, das ein zweites Mal entstehen koennte; ein
    // Schluessel waere Beiwerk, das Bedeutung vortaeuscht.
    const reads: Recorded[] = [];
    await gatewayWith(stubFetch(200, VALID_WINDOW, reads)).getPlanningWindow({
      weekKey: "2026-W32",
    });
    expect((reads[0]?.init?.headers as Record<string, string>)[IDEMPOTENCY_HEADER]).toBeUndefined();
  });

  it("haengt die Wochenabfrage an die URL und nicht in den Koerper", async () => {
    const recorded: Recorded[] = [];
    await gatewayWith(stubFetch(200, VALID_WINDOW, recorded)).getPlanningWindow({
      weekKey: "2026-W32",
    });
    expect(recorded[0]?.url).toBe(`${BASE}/planung/fenster?weekKey=2026-W32`);
    expect(recorded[0]?.init?.method).toBe("GET");
    expect(recorded[0]?.init?.body).toBeUndefined();
  });

  it("reicht die Authorization durch, statt sie zu erfinden", async () => {
    const recorded: Recorded[] = [];
    await gatewayWith(stubFetch(200, VALID_WINDOW, recorded)).getPlanningWindow({
      weekKey: "2026-W32",
    });
    const headers = (recorded[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer testtoken");

    // Ohne Quelle kein Header — der Client baut sich keinen zusammen.
    const bare: Recorded[] = [];
    await new HttpPlanningGateway({
      baseUrl: BASE,
      fetchImpl: stubFetch(200, VALID_WINDOW, bare),
    }).getPlanningWindow({ weekKey: "2026-W32" });
    expect((bare[0]?.init?.headers ?? {}) as Record<string, string>).not.toHaveProperty(
      "authorization",
    );
  });
});
