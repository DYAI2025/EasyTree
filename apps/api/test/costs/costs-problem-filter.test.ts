/**
 * Beide Zweige des `CostsProblemFilter` (EYT-139).
 *
 * ## Warum diese Datei existiert
 *
 * Gemessen, nicht vermutet: `HttpExceptionFilter` setzt `type` hart auf
 * `"about:blank"` und liest aus einer `HttpException` ausschliesslich `detail`.
 * Der einzige Weg, auf dem ein stabiler URN heute nach draussen gelangt, ist
 * dieser Filter. Er traegt seit EYT-139 zwei Zweige: den bestehenden fuer
 * `ConflictProblem` (immer 409, immer „Konflikt") und den neuen fuer
 * `CostsProblem`, das Status und Titel selbst mitbringt.
 *
 * Jeder Fall vergleicht den GANZEN Antwortrumpf mit einem `toEqual` und nicht
 * Feld fuer Feld. Der Grund ist derselbe wie in `cost-snapshot-dto.test.ts`:
 * eine feldweise Pruefung uebersieht ein zusaetzliches Feld, und ein
 * zusaetzliches Feld ist hier fatal — `ProblemDocumentSchema` ist ein
 * `z.strictObject`, und `readProblem` in `packages/contracts/src/http/costs-gateway.ts`
 * verwirft bei einem Fehlschlag das GANZE Dokument, nicht nur das Extrafeld.
 * Alle Werte sind paarweise verschieden, damit eine vertauschte Zuweisung
 * ueberhaupt beobachtbar ist.
 *
 * ## Gegenmutationen — alle eingespielt und gemessen
 *
 * - Filter: `title` immer auf `"Konflikt"` -> Fall 2 rot, Fall 1 gruen.
 * - Filter: `status` immer auf `HttpStatus.CONFLICT` -> Fall 2 rot, Fall 1 gruen.
 * - Filter: `correlationId ?? "unknown"` durch `?? ""` -> Fall 3 rot.
 * - Filter: `detail: exception.message` durch `detail: exception.type` -> Faelle
 *   1, 2 und 3 rot (alle drei vergleichen den ganzen Rumpf).
 *
 * Dass die ersten beiden Mutationen Fall 1 GRUEN lassen, ist Teil der Aussage:
 * der Regressionszweig misst etwas anderes als der neue. Ohne diese Trennung
 * koennte ein Umbau des Filters das Verhalten der EYT-108-Satzrouten still
 * veraendern, ohne dass ein Test es meldet.
 */
import type { ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

// Ueber die oeffentliche Modul-API, wie die Nachbartests. Ein tiefer Pfad nach
// `costs/interface/http/…` faellt am Waechter
// `costs-cross-module-public-api-only` — auch aus einem Test, weil `moduleOf`
// Testdateien keinem Modul zuordnet.
import { ConflictProblem, CostsProblem, CostsProblemFilter } from "../../src/modules/costs";
import type { CostsProblemStatus } from "../../src/modules/costs";

/**
 * Minimaler `ArgumentsHost` mit aufzeichnender Antwort.
 *
 * Bewusst kein Nest-Testserver: geprueft wird der Filter, nicht das Routing
 * (gleiche Bauart wie `hostMit` in `planning-problem.test.ts`). `status` gibt
 * die Antwort selbst zurueck, weil der Filter `res.status(…).json(…)` kettet —
 * gaebe der Stub etwas anderes zurueck, pruefte diese Datei eine Kette, die es
 * in Express nicht gibt.
 */
function hostMit(korrelation: string | undefined): {
  host: ArgumentsHost;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn();
  const res = { status, json };
  status.mockReturnValue(res);
  const req = korrelation === undefined ? {} : { correlationId: korrelation };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

/**
 * Die Faelle des zweiten Zweigs, mit `CostsProblemStatus` statt `number`.
 *
 * Die Annotation ist noetig, nicht dekorativ: aus einem blanken Arrayliteral
 * folgert TypeScript `status: number`, und der Konstruktor nimmt seit dem
 * verengten Statusbereich nur noch die vier erlaubten Codes.
 */
const EIGENER_STATUS: {
  status: CostsProblemStatus;
  title: string;
  type: string;
  detail: string;
  korrelation: string;
}[] = [
  {
    status: 400,
    title: "Ungueltige Anfrage",
    type: "urn:easytree:costs:label-missing",
    detail: "Der Person fehlt ein Anzeigename.",
    korrelation: "korrelation-vierhundert",
  },
  {
    status: 500,
    title: "Schreibkanal abgelehnt",
    type: "urn:easytree:costs:write-channel-rejected",
    detail: "Die Verbindung war nicht der Laufzeitkanal.",
    korrelation: "korrelation-fuenfhundert",
  },
];

/** Der einzige Aufrufrumpf — mit der Zusicherung, dass es genau einen gibt. */
function koerperVon(json: ReturnType<typeof vi.fn>): unknown {
  expect(json).toHaveBeenCalledTimes(1);
  const [koerper] = json.mock.calls[0] as [unknown];
  return koerper;
}

describe("CostsProblemFilter (EYT-139)", () => {
  it('gibt ein ConflictProblem unveraendert als 409 mit Titel „Konflikt" heraus', () => {
    // Regressionsprobe fuer die EYT-108-Satzrouten. Geht sie kaputt, aendert der
    // zweite Zweig still das Verhalten von `POST /kosten/stundensaetze`.
    const { host, status, json } = hostMit("korrelation-konflikt");

    new CostsProblemFilter().catch(
      new ConflictProblem(
        "urn:easytree:costs:rate-interval-overlap",
        "Zwei Saetze ueberlappen sich.",
      ),
      host,
    );

    expect(status).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(409);
    expect(koerperVon(json)).toEqual({
      type: "urn:easytree:costs:rate-interval-overlap",
      title: "Konflikt",
      status: 409,
      detail: "Zwei Saetze ueberlappen sich.",
      correlationId: "korrelation-konflikt",
    });
  });

  // Zwei Durchlaeufe mit VERSCHIEDENEN Statuscodes: haetten wir nur einen, haenge
  // die Aussage „Status kommt aus der Ausnahme" an einem einzelnen Wert, und
  // eine festverdrahtete Konstante an seiner Stelle bliebe gruen. Beide Werte
  // sind ausserdem NICHT 409 und beide Titel NICHT „Konflikt", sonst waere der
  // Fall von der Vorbelegung des anderen Zweigs nicht zu unterscheiden.
  it.each(EIGENER_STATUS)("traegt Status $status und Titel aus dem CostsProblem heraus", (fall) => {
    const { host, status, json } = hostMit(fall.korrelation);

    new CostsProblemFilter().catch(
      new CostsProblem({
        status: fall.status,
        title: fall.title,
        type: fall.type,
        detail: fall.detail,
      }),
      host,
    );

    expect(status).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(fall.status);
    expect(koerperVon(json)).toEqual({
      type: fall.type,
      title: fall.title,
      status: fall.status,
      detail: fall.detail,
      correlationId: fall.korrelation,
    });
  });

  it('setzt „unknown", wenn die Anfrage keine Korrelations-Id traegt', () => {
    // Der Filter kann vor der `CorrelationIdMiddleware` greifen — etwa wenn ein
    // Test den Filter direkt fuettert oder ein Fehler vor der Middleware
    // entsteht. Ein leerer String waere im Betriebsprotokoll nicht von einer
    // verlorenen Id zu unterscheiden; „unknown" sagt, dass niemand eine hatte.
    const { host, status, json } = hostMit(undefined);

    new CostsProblemFilter().catch(
      new CostsProblem({
        status: 403,
        title: "Kein Kostenzugriff",
        type: "urn:easytree:costs:snapshot-not-found",
        detail: "Der Snapshot ist unter dieser Id nicht sichtbar.",
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(koerperVon(json)).toEqual({
      type: "urn:easytree:costs:snapshot-not-found",
      title: "Kein Kostenzugriff",
      status: 403,
      detail: "Der Snapshot ist unter dieser Id nicht sichtbar.",
      correlationId: "unknown",
    });
  });
});
