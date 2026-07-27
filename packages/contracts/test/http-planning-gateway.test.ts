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
import { IDEMPOTENCY_HEADER } from "../src/primitives.js";

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
    // Fest statt zufaellig: nur so laesst sich pruefen, dass eine Wiederholung
    // denselben Schluessel traegt — und genau das ist die Aussage von Idempotenz.
    newIdempotencyKey: () => "11111111-1111-4111-8111-111111111111",
    authorization: () => "Bearer testtoken",
  });
}

const VALID_WINDOW = {
  weekKey: "2026-W32",
  timeZone: "Europe/Berlin",
  assignments: [],
  publishedVersionId: null,
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
    const publish = await gatewayWith(stubFetch(409, problem, [])).publishPlan({
      weekKey: "2026-W32",
      expectedVersionId: null,
    });
    expect(publish.ok).toBe(false);
    if (publish.ok) return;
    expect(publish.failure).toBe("STALE_VERSION");

    const create = await gatewayWith(stubFetch(409, problem, [])).createAssignment({
      employeeId: "00000000-0000-0000-0000-0000004010a1",
      worksiteId: "00000000-0000-0000-0000-0000005010a1",
      interval: { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T14:00:00.000Z" },
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
  it("sendet den Idempotenzschluessel nur bei schreibenden Aufrufen", async () => {
    const writes: Recorded[] = [];
    await gatewayWith(
      stubFetch(
        200,
        {
          versionId: "00000000-0000-0000-0000-0000006010a1",
          weekKey: "2026-W32",
          publishedAtUtc: "2026-07-31T12:00:00.000Z",
          assignmentIds: [],
        },
        writes,
      ),
    ).publishPlan({ weekKey: "2026-W32", expectedVersionId: null });

    const reads: Recorded[] = [];
    await gatewayWith(stubFetch(200, VALID_WINDOW, reads)).getPlanningWindow({
      weekKey: "2026-W32",
    });

    const headerOf = (r: Recorded): Record<string, string> =>
      (r.init?.headers ?? {}) as Record<string, string>;
    expect(headerOf(writes[0]!)[IDEMPOTENCY_HEADER]).toBe("11111111-1111-4111-8111-111111111111");
    // Gegenprobe: ein Lesevorgang erzeugt nichts, das ein zweites Mal
    // entstehen koennte — ein Schluessel dort waere Beiwerk, das Bedeutung
    // vortaeuscht.
    expect(headerOf(reads[0]!)[IDEMPOTENCY_HEADER]).toBeUndefined();
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
