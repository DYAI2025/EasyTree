/**
 * Die Publish-Aktion der Planungsansicht (EYT-107).
 *
 * ## Die Aussage, um die es geht
 *
 * Keine optimistische Scheinveroeffentlichung. Die Oberflaeche darf
 * „Veroeffentlicht" erst zeigen, wenn der SERVER es sagt — sonst sieht die
 * Planerin einen Zustand, den PostgreSQL nicht kennt. Der Fall
 * „Gateway antwortet mit einem Fehler, Stand bleibt Entwurf" ist deshalb
 * kein Randfall, sondern der Kern dieser Datei.
 *
 * ## Warum auf `problem.type` verzweigt wird und nicht nur auf `failure`
 *
 * `HttpPlanningGateway.publishPlan` bildet JEDEN 409 auf `STALE_VERSION` ab.
 * Vier fachlich verschiedene Ablehnungen kommen also mit demselben `failure`
 * an. Die Unterscheidung traegt allein der `type` im Problemdokument.
 *
 * Gegenmutationen, die diese Datei rot machen:
 *   - in `PlanningPublishAction` den Zustand vor dem `await` auf
 *     „veroeffentlicht" setzen -> „behauptet keinen Erfolg vor der Antwort";
 *   - die Rechtepruefung entfernen -> „ohne planning.publish keine Aktion";
 *   - den Schluessel je Klick neu erzeugen -> „derselbe Vorgang behaelt
 *     seinen Schluessel".
 */
import type { GatewayResult, PublishedPlanVersion } from "@easytree/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanningPublishAction } from "../components/planning-publish-action";

afterEach(cleanup);

const VERSION_ID = "00000000-0000-4000-8000-0000006010a1";
const WOCHE = "2026-W32";

const ERFOLG: PublishedPlanVersion = {
  versionId: VERSION_ID,
  weekKey: WOCHE,
  publishedAtUtc: "2026-08-03T10:00:00.000Z",
  assignmentIds: ["00000000-0000-4000-8000-0000007010a1"],
};

interface RenderOptions {
  readonly darfVeroeffentlichen?: boolean;
  readonly sourceVersionId?: string | null;
  readonly istEntwurf?: boolean;
  readonly antwort?: GatewayResult<PublishedPlanVersion>;
  readonly antworten?: readonly GatewayResult<PublishedPlanVersion>[];
}

function zeichne(options: RenderOptions = {}): {
  publishPlan: ReturnType<typeof vi.fn>;
  neuLaden: ReturnType<typeof vi.fn>;
} {
  const antworten = [...(options.antworten ?? [options.antwort ?? { ok: true, value: ERFOLG }])];
  const publishPlan = vi.fn(() =>
    Promise.resolve(antworten.shift() ?? { ok: true, value: ERFOLG }),
  );
  const neuLaden = vi.fn();

  render(
    <PlanningPublishAction
      weekKey={WOCHE}
      sourceVersion={
        options.sourceVersionId === null
          ? null
          : {
              id: options.sourceVersionId ?? VERSION_ID,
              state: (options.istEntwurf ?? true) ? "draft" : "published",
            }
      }
      darfVeroeffentlichen={options.darfVeroeffentlichen ?? true}
      publishPlan={publishPlan as never}
      onVeroeffentlicht={neuLaden}
    />,
  );
  return { publishPlan, neuLaden };
}

const aktion = (): HTMLElement | null => screen.queryByTestId("planung-veroeffentlichen");

describe("Sichtbarkeit der Aktion", () => {
  it("zeigt sie fuer einen Entwurf mit planning.publish", () => {
    zeichne();
    expect(aktion()).not.toBeNull();
    expect(aktion()?.textContent).toContain("Plan veröffentlichen");
  });

  it("zeigt sie NICHT ohne planning.publish", () => {
    // Ein sichtbarer Knopf ersetzt keine Autorisierung — aber ihn zu zeigen,
    // wo er nie funktionieren kann, ist eine Zumutung. Der Server lehnt
    // unabhaengig ab (planning-publish.http.test.ts).
    zeichne({ darfVeroeffentlichen: false });
    expect(aktion()).toBeNull();
  });

  it("zeigt sie NICHT, wenn die Woche bereits veroeffentlicht ist", () => {
    zeichne({ istEntwurf: false });
    expect(aktion()).toBeNull();
  });

  it("zeigt sie NICHT, wenn es fuer die Woche gar keine Version gibt", () => {
    zeichne({ sourceVersionId: null });
    expect(aktion()).toBeNull();
  });
});

describe("Zustandsdarstellung", () => {
  it("nennt den Stand als Text, nicht nur farblich", () => {
    zeichne();
    const marke = screen.getByTestId("planung-stand-marke");
    expect(marke.textContent).toContain("Entwurf");
  });

  it("zeigt nach Erfolg den veroeffentlichten Stand mit Textmarke", async () => {
    zeichne();
    fireEvent.click(aktion() as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId("planung-publish-erfolg")).not.toBeNull();
    });
    expect(screen.getByTestId("planung-publish-erfolg").textContent).toContain("Veröffentlicht");
  });

  it("meldet dem Elternteil den Serverstand, statt ihn selbst zu behaupten", async () => {
    const { neuLaden } = zeichne();
    fireEvent.click(aktion() as HTMLElement);
    await waitFor(() => expect(neuLaden).toHaveBeenCalledTimes(1));
    expect(neuLaden).toHaveBeenCalledWith(ERFOLG);
  });
});

describe("Keine optimistische Scheinveroeffentlichung", () => {
  it("behauptet keinen Erfolg, wenn der Server nicht erreichbar ist", async () => {
    const { neuLaden } = zeichne({
      antwort: { ok: false, failure: "UNAVAILABLE", problem: null },
    });
    fireEvent.click(aktion() as HTMLElement);

    await waitFor(() => {
      expect(screen.getByTestId("planung-publish-fehler")).not.toBeNull();
    });
    // Der Stand bleibt Entwurf, und das Elternteil wurde NICHT benachrichtigt.
    expect(screen.getByTestId("planung-stand-marke").textContent).toContain("Entwurf");
    expect(screen.queryByTestId("planung-publish-erfolg")).toBeNull();
    expect(neuLaden).not.toHaveBeenCalled();
  });

  it("sperrt die Aktion waehrend des Absendens", async () => {
    let aufloesen: ((wert: GatewayResult<PublishedPlanVersion>) => void) | null = null;
    const publishPlan = vi.fn(
      () =>
        new Promise<GatewayResult<PublishedPlanVersion>>((resolve) => {
          aufloesen = resolve;
        }),
    );
    render(
      <PlanningPublishAction
        weekKey={WOCHE}
        sourceVersion={{ id: VERSION_ID, state: "draft" }}
        darfVeroeffentlichen
        publishPlan={publishPlan as never}
        onVeroeffentlicht={vi.fn()}
      />,
    );

    const knopf = aktion() as HTMLButtonElement;
    fireEvent.click(knopf);
    await waitFor(() => expect(knopf.disabled).toBe(true));
    expect(knopf.textContent).toContain("wird veröffentlicht");

    // Der eigentliche Nachweis, und er braucht GENAU diesen Moment: solange
    // die Antwort aussteht, darf NICHTS „Veröffentlicht" behaupten.
    //
    // Diese drei Zeilen sind nachtraeglich entstanden, weil die ausgefuehrte
    // Gegenmutation GM-10 (Zustand vor dem `await` auf Erfolg setzen) den
    // Fall „behauptet keinen Erfolg, wenn der Server nicht erreichbar ist"
    // GRUEN liess: der spaetere `setAblauf({kind:"abgelehnt"})` ueberschreibt
    // die optimistische Anzeige, bevor `waitFor` sie sehen kann. Ein
    // KURZZEITIG falsches „Veröffentlicht" ist aber genau der Fehler, um den
    // es geht — die Planerin sieht es. Ohne diese Assertion misst die Suite
    // den Zwischenzustand nicht.
    expect(screen.queryByTestId("planung-publish-erfolg")).toBeNull();
    expect(screen.getByTestId("planung-stand-marke").textContent).toContain("Entwurf");

    // Ein zweiter Klick darf keinen zweiten Aufruf ausloesen.
    fireEvent.click(knopf);
    expect(publishPlan).toHaveBeenCalledTimes(1);

    (aufloesen as unknown as (w: GatewayResult<PublishedPlanVersion>) => void)({
      ok: true,
      value: ERFOLG,
    });
    await waitFor(() => expect(screen.queryByTestId("planung-publish-erfolg")).not.toBeNull());
  });
});

describe("Die vier Ablehnungen sind unterscheidbar", () => {
  const problem = (typ: string): GatewayResult<PublishedPlanVersion> => ({
    ok: false,
    failure: "STALE_VERSION",
    problem: {
      type: `urn:easytree:planning:${typ}`,
      title: "Titel",
      status: 409,
      detail: "Erklaerung",
      correlationId: "k-1",
    },
  });

  it("zeigt bei stale-version die Leiste aus dem Basisdesign", async () => {
    zeichne({ antwort: problem("stale-version") });
    fireEvent.click(aktion() as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId("planung-publish-fehler")).not.toBeNull());
    const leiste = screen.getByTestId("planung-publish-fehler");
    // Wortlaut aus Basisdesign v2.0 §3.1 („Veraltet").
    expect(leiste.textContent).toContain("Plan wurde geändert");
    expect(leiste.getAttribute("data-problem")).toBe("stale-version");
  });

  it.each([
    ["already-published", "bereits veröffentlicht"],
    ["blocking-conflict", "Konflikt"],
    ["assignment-outside-week", "Woche"],
  ])("unterscheidet %s", async (typ, textstueck) => {
    zeichne({ antwort: problem(typ) });
    fireEvent.click(aktion() as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId("planung-publish-fehler")).not.toBeNull());
    const leiste = screen.getByTestId("planung-publish-fehler");
    expect(leiste.getAttribute("data-problem")).toBe(typ);
    expect(leiste.textContent).toContain(textstueck);
  });

  it("laedt bei stale-version und already-published die Woche neu", async () => {
    const { neuLaden } = zeichne({ antwort: problem("stale-version") });
    fireEvent.click(aktion() as HTMLElement);
    // `null` heisst: neu laden, aber ohne veroeffentlichte Version.
    await waitFor(() => expect(neuLaden).toHaveBeenCalledWith(null));
  });

  it("laedt bei einem blockierenden Konflikt NICHT neu", async () => {
    // Ein Neuladen wuerde die Konfliktmeldung wegwischen, bevor die Planerin
    // sie gelesen hat — und am Konflikt aendert es nichts.
    const { neuLaden } = zeichne({ antwort: problem("blocking-conflict") });
    fireEvent.click(aktion() as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId("planung-publish-fehler")).not.toBeNull());
    expect(neuLaden).not.toHaveBeenCalled();
  });
});

describe("Idempotenzschluessel", () => {
  it("behaelt denselben Schluessel ueber einen Wiederholungsversuch", async () => {
    // Der Fall, fuer den der Schluessel existiert: die Antwort geht verloren,
    // die Planerin drueckt erneut. Ein frischer Schluessel wuerde daraus einen
    // ZWEITEN Vorgang machen — genau der Doppeleffekt, den er verhindern soll.
    const { publishPlan } = zeichne({
      antworten: [
        { ok: false, failure: "UNAVAILABLE", problem: null },
        { ok: true, value: ERFOLG },
      ],
    });

    fireEvent.click(aktion() as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId("planung-publish-fehler")).not.toBeNull());
    fireEvent.click(aktion() as HTMLElement);
    await waitFor(() => expect(publishPlan).toHaveBeenCalledTimes(2));

    const ersterSchluessel = publishPlan.mock.calls[0]?.[1] as { idempotencyKey: string };
    const zweiterSchluessel = publishPlan.mock.calls[1]?.[1] as { idempotencyKey: string };
    expect(zweiterSchluessel.idempotencyKey).toBe(ersterSchluessel.idempotencyKey);
  });

  it("sendet Woche und erwartete Version aus dem SERVERstand", async () => {
    const { publishPlan } = zeichne();
    fireEvent.click(aktion() as HTMLElement);
    await waitFor(() => expect(publishPlan).toHaveBeenCalledTimes(1));
    expect(publishPlan.mock.calls[0]?.[0]).toEqual({
      weekKey: WOCHE,
      expectedVersionId: VERSION_ID,
    });
  });
});
