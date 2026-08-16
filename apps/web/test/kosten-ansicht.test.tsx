/**
 * Die Kostenansicht zeigt GESPEICHERTE Werte und rechnet nichts (EYT-144).
 *
 * ## Die Fixtur IST die Gegenmutation
 *
 * `SNAPSHOT.totalMinorUnits` (999999) widerspricht absichtlich der Summe seiner
 * Positionen (1000 + 2000 = 3000), und die Tagessumme (7777) widerspricht
 * beiden. Alle drei Zahlen sind in einer schemagueltigen Antwort erlaubt —
 * `CostSnapshotSchema` prueft ausdruecklich die STRUKTUR und nicht die
 * Arithmetik, genau fuer diesen Fall. Faengt die Oberflaeche an, selbst zu
 * summieren, zeigt sie 30,00 statt 9.999,99 und `A1` wird rot. Ein dauerhafter
 * Fall statt einer Mutation, die man einspielt und wieder zuruecknimmt.
 *
 * ## Warum das Gateway seine Aufrufe mitschreibt
 *
 * Der Reload-Vertrag ist eine Aussage darueber, was NICHT passiert: beim
 * Oeffnen von `/kosten?snapshot=<id>` darf kein `createSnapshot` und keine
 * Satz- oder Planversionsabfrage laufen. Ein Zustand allein bewiese das nicht —
 * die Ansicht koennte den Snapshot anzeigen UND nebenbei neu rechnen. Deshalb
 * werfen die ungenutzten Methoden, und `aufrufe` zaehlt die benutzten.
 *
 * ## Gegenmutationen — eingespielt, gemessen, zurueckgenommen (13.08.2026)
 *
 * Diese Datei entstand NACH der Komponente und hatte deshalb keine rote Phase.
 * Die beiden Mutationen sind der Ersatz dafuer; beide wurden wirklich gefahren:
 *
 * - Die Gesamtsumme aus den Positionen summieren statt `totalMinorUnits`
 *   anzuzeigen: A1 rot (1 von 22).
 * - Einen modulweiten, festen Idempotenzschluessel statt eines frischen je
 *   Handlung verwenden: A10 rot (1 von 22).
 */
import type {
  CostSnapshot,
  CostsGateway,
  GatewayFailure,
  GatewayResult,
  ProblemDocument,
  SelectablePlanVersions,
  SelectableWorksites,
} from "@easytree/contracts";
import { CostSnapshotSchema } from "@easytree/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { KostenAnsicht } from "../components/kosten-ansicht";
import { CostsGatewayProvider } from "../lib/costs-gateway-provider";

const VERSION_A = "00000000-0000-4000-8000-0000009a0001";
const VERSION_B = "00000000-0000-4000-8000-0000009a0002";
const SNAPSHOT_ID = "00000000-0000-4000-8000-0000009b0001";
const POSITION_EINS = "00000000-0000-4000-8000-0000009c0001";
const POSITION_ZWEI = "00000000-0000-4000-8000-0000009c0002";
const ERZEUGER = "00000000-0000-4000-8000-0000009d0001";

const VERSIONEN: SelectablePlanVersions = {
  versions: [
    { id: VERSION_A, weekKey: "2026-W32", publishedAt: "2026-08-01T07:08:09.010Z" },
    { id: VERSION_B, weekKey: "2026-W33", publishedAt: "2026-08-08T11:12:13.140Z" },
  ],
};

/**
 * Die Baustellen der beiden Planversionen — bewusst DISJUNKT (EYT-146).
 *
 * Kein gemeinsamer Eintrag: waeren die Listen gleich, koennte eine Ansicht die
 * alte Auswahl beim Versionswechsel stehen lassen und A19 bliebe gruen, obwohl
 * eine Baustelle der VORIGEN Version in den Snapshot-Auftrag reiste.
 */
const BAUSTELLE_A_NORD = "00000000-0000-4000-8000-00000000ba01";
const BAUSTELLE_A_SUED = "00000000-0000-4000-8000-00000000ba02";
const BAUSTELLE_B_WEST = "00000000-0000-4000-8000-00000000bb01";

const BAUSTELLEN_ZU_A: SelectableWorksites = {
  worksites: [
    { id: BAUSTELLE_A_NORD, label: "Baustelle Nord" },
    { id: BAUSTELLE_A_SUED, label: "Baustelle Süd" },
  ],
};

const BAUSTELLEN_ZU_B: SelectableWorksites = {
  worksites: [{ id: BAUSTELLE_B_WEST, label: "Baustelle West" }],
};

/** Antwortet je Planversion — die Voraussetzung dafuer, dass A19 etwas misst. */
function baustellenJeVersion(planVersionId: string): GatewayResult<SelectableWorksites> {
  return { ok: true, value: planVersionId === VERSION_B ? BAUSTELLEN_ZU_B : BAUSTELLEN_ZU_A };
}

/** Kopfsumme, Tagessumme und Positionssumme widersprechen sich ABSICHTLICH. */
const SNAPSHOT: CostSnapshot = {
  id: SNAPSHOT_ID,
  planVersionId: VERSION_A,
  worksiteId: null,
  weekKey: "2026-W32",
  timeZone: "Europe/Berlin",
  currency: "EUR",
  ruleVersion: "personnel-plan-cost-v1",
  createdAt: "2026-08-05T09:30:00.000Z",
  createdBy: ERZEUGER,
  correlationId: "korrelation-der-ansicht",
  totalMinorUnits: "999999",
  days: [{ localDate: "2026-08-03", amountMinorUnits: "7777" }],
  positions: [
    {
      id: POSITION_EINS,
      assignmentId: "00000000-0000-4000-8000-0000009e0001",
      worksiteId: "00000000-0000-4000-8000-0000009f0001",
      worksiteLabel: "Baustelle Nord",
      employeeId: "00000000-0000-4000-8000-000000a00001",
      employeeLabel: "Bernd Christ",
      localDate: "2026-08-03",
      durationMilliseconds: "28800000",
      rateVersionId: "00000000-0000-4000-8000-000000a10001",
      amountMinorUnits: "1000",
    },
    {
      id: POSITION_ZWEI,
      assignmentId: "00000000-0000-4000-8000-0000009e0002",
      worksiteId: "00000000-0000-4000-8000-0000009f0002",
      worksiteLabel: "Baustelle Süd",
      employeeId: "00000000-0000-4000-8000-000000a00002",
      employeeLabel: "Anna Bauer",
      localDate: "2026-08-03",
      durationMilliseconds: "5400000",
      rateVersionId: "00000000-0000-4000-8000-000000a10002",
      amountMinorUnits: "2000",
    },
  ],
};

interface Aufrufe {
  readonly versionen: unknown[];
  /** Je Aufruf die WIRKLICH angefragte Planversions-Id (EYT-146). */
  readonly baustellen: string[];
  readonly erzeugt: unknown[];
  readonly gelesen: string[];
  readonly schluessel: string[];
}

interface Antworten {
  readonly versionen?: GatewayResult<SelectablePlanVersions>;
  readonly erzeugen?: GatewayResult<CostSnapshot>;
  readonly lesen?: GatewayResult<CostSnapshot>;
  /** Haelt `createSnapshot` offen, damit der Zwischenzustand sichtbar wird. */
  readonly erzeugenHaengt?: boolean;
  /** Antwort der Baustellenauswahl — je Planversion, damit A19 messbar ist. */
  readonly baustellen?: (planVersionId: string) => GatewayResult<SelectableWorksites>;
  /** Haelt die Baustellenauswahl offen, damit ihr Ladezustand sichtbar wird. */
  readonly baustellenHaengt?: boolean;
}

function fehler<T>(
  grund: GatewayFailure,
  problem: ProblemDocument | null = null,
): GatewayResult<T> {
  return { ok: false, failure: grund, problem };
}

function problem(type: string, detail: string): ProblemDocument {
  return { type, title: "Konflikt", status: 409, detail, correlationId: "korrelation-1" };
}

function baue(antworten: Antworten = {}): { gateway: CostsGateway; aufrufe: Aufrufe } {
  const aufrufe: Aufrufe = {
    versionen: [],
    baustellen: [],
    erzeugt: [],
    gelesen: [],
    schluessel: [],
  };
  const gateway: CostsGateway = {
    // Diese drei gehoeren zur Satzverwaltung. Sie werfen, statt etwas
    // Plausibles zu liefern: ruft die Kostenansicht sie doch, soll der Fall
    // laut scheitern und nicht still auf einer erfundenen Antwort weiterlaufen.
    listEmployees: () => {
      throw new Error("in der Kostenansicht nicht benutzt");
    },
    rateHistory: () => {
      throw new Error("die Kostenansicht darf keine aktuellen Saetze laden");
    },
    createRateVersion: () => {
      throw new Error("in der Kostenansicht nicht benutzt");
    },
    publishedPlanVersions: (query) => {
      aufrufe.versionen.push(query);
      return Promise.resolve(antworten.versionen ?? { ok: true, value: VERSIONEN });
    },
    worksitesForPublishedPlanVersion: (planVersionId) => {
      aufrufe.baustellen.push(planVersionId);
      if (antworten.baustellenHaengt === true) return new Promise(() => {});
      return Promise.resolve(
        antworten.baustellen?.(planVersionId) ?? { ok: true, value: BAUSTELLEN_ZU_A },
      );
    },
    createSnapshot: (command, optionen) => {
      aufrufe.erzeugt.push(command);
      aufrufe.schluessel.push(optionen.idempotencyKey);
      if (antworten.erzeugenHaengt === true) return new Promise(() => {});
      return Promise.resolve(antworten.erzeugen ?? { ok: true, value: SNAPSHOT });
    },
    snapshot: (snapshotId) => {
      aufrufe.gelesen.push(snapshotId);
      return Promise.resolve(antworten.lesen ?? { ok: true, value: SNAPSHOT });
    },
  };
  return { gateway, aufrufe };
}

function zeige(antworten: Antworten = {}, snapshotId: string | null = null): { aufrufe: Aufrufe } {
  const { gateway, aufrufe } = baue(antworten);
  render(
    <CostsGatewayProvider gateway={gateway}>
      <KostenAnsicht snapshotId={snapshotId} />
    </CostsGatewayProvider>,
  );
  return { aufrufe };
}

async function ladeVersionen(von = "2026-W32", bis = "2026-W33"): Promise<void> {
  await userEvent.type(screen.getByLabelText("Von Woche"), von);
  await userEvent.type(screen.getByLabelText("Bis Woche"), bis);
  await userEvent.click(screen.getByRole("button", { name: "Planversionen laden" }));
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/kosten");
});

describe("Kostenansicht — Auswahl, Erzeugung, gespeicherter Stand (EYT-144)", () => {
  it("A1 zeigt die GESPEICHERTE Gesamtsumme, nicht die Summe der Positionen", async () => {
    // Die Fixtur ist schemagueltig — sonst bewiese der Fall nur, dass ein
    // kaputter Snapshot nicht angezeigt wird.
    expect(CostSnapshotSchema.safeParse(SNAPSHOT).success).toBe(true);

    zeige({}, SNAPSHOT_ID);
    await screen.findByTestId("kosten-snapshot");

    // 999999 Minor Units. Die Summe der Positionen waere 30,00 — genau die
    // Zahl, die eine nachrechnende Oberflaeche zeigte.
    expect(screen.getByTestId("kosten-gesamtsumme").textContent).toBe("9.999,99 EUR");
    expect(screen.queryByText("30,00 EUR")).toBeNull();

    // Und die Tagessumme kommt ebenfalls aus dem Snapshot, nicht aus den
    // Positionen dieses Tages.
    const tag = screen.getByTestId("kosten-tag");
    expect(tag.textContent).toContain("77,77 EUR");
  });

  it("A2 zeigt jede Position mit Herkunft und Betrag", async () => {
    zeige({}, SNAPSHOT_ID);
    await screen.findByTestId("kosten-snapshot");

    const zeilen = screen.getAllByTestId("kosten-position");
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]?.textContent).toContain("Baustelle Nord");
    expect(zeilen[0]?.textContent).toContain("Bernd Christ");
    expect(zeilen[0]?.textContent).toContain("2026-08-03");
    // 28800000 ms = 8 Stunden, in bigint gerechnet.
    expect(zeilen[0]?.textContent).toContain("8:00 h");
    expect(zeilen[0]?.textContent).toContain("10,00 EUR");
    // 5400000 ms = 1,5 Stunden — der Fall, den eine Ganzzahldivision auf
    // Stunden verschluckte.
    expect(zeilen[1]?.textContent).toContain("1:30 h");
    expect(zeilen[1]?.textContent).toContain("20,00 EUR");
    // Die Satzversion je Zeile: ohne sie ist der Betrag nicht nachvollziehbar.
    expect(zeilen[0]?.textContent).toContain("00000000-0000-4000-8000-000000a10001");
  });

  it("A3 nennt Kopfdaten des gespeicherten Standes wahrheitsgemaess", async () => {
    zeige({}, SNAPSHOT_ID);
    await screen.findByTestId("kosten-snapshot");

    expect(screen.getByTestId("kosten-snapshot-id").textContent).toBe(SNAPSHOT_ID);
    expect(screen.getByTestId("kosten-planversion-id").textContent).toBe(VERSION_A);
    expect(screen.getByTestId("kosten-regelversion").textContent).toBe("personnel-plan-cost-v1");
    expect(screen.getByTestId("kosten-waehrung").textContent).toBe("EUR");
    // Kein erfundener Name: ohne Namensaufloesung steht die wahre Id da.
    expect(screen.getByTestId("kosten-erzeuger").textContent).toBe(ERZEUGER);
    expect(screen.getByTestId("kosten-baustellenfilter").textContent).toBe("alle Baustellen");
  });

  it("A4 laedt beim Reload NUR den gespeicherten Snapshot", async () => {
    const { aufrufe } = zeige({}, SNAPSHOT_ID);
    await screen.findByTestId("kosten-snapshot");

    expect(aufrufe.gelesen).toEqual([SNAPSHOT_ID]);
    // Kein Erzeugen, keine Auswahlliste, keine Saetze. `rateHistory` und
    // `listEmployees` wuerden werfen; dass sie es nicht taten, steht hier
    // zusaetzlich als Zahl.
    expect(aufrufe.erzeugt).toEqual([]);
    expect(aufrufe.versionen).toEqual([]);
    // Und seit EYT-146 auch KEINE Baustellenauswahl: der Reload-Vertrag ist
    // eine Aussage darueber, was NICHT passiert, und eine neue Leseroute ist
    // genau die Art Zusatz, die ihn unbemerkt aufweicht.
    expect(aufrufe.baustellen).toEqual([]);
  });

  it("A5 zeigt den Ladezustand des gespeicherten Snapshots", () => {
    const { gateway } = baue();
    render(
      <CostsGatewayProvider gateway={{ ...gateway, snapshot: () => new Promise(() => {}) }}>
        <KostenAnsicht snapshotId={SNAPSHOT_ID} />
      </CostsGatewayProvider>,
    );
    // Text, nicht Farbe: der Zustand ist vorlesbar.
    expect(screen.getByTestId("kosten-snapshot-laedt").textContent).toContain("wird geladen");
  });

  it("A6 lehnt einen verkehrten Wochenbereich LOKAL ab und ruft das Gateway nicht", async () => {
    const { aufrufe } = zeige();
    await ladeVersionen("2026-W33", "2026-W32");

    expect(screen.getByTestId("kosten-eingabefehler").textContent).toContain(
      "gültige Kalenderwochen",
    );
    // Der Nachweis, dass die Pruefung wirkt und nicht nur der Server ablehnt.
    expect(aufrufe.versionen).toEqual([]);
  });

  it("A7 sagt es ehrlich, wenn keine Planversion veroeffentlicht ist", async () => {
    zeige({ versionen: { ok: true, value: { versions: [] } } });
    await ladeVersionen();

    const leer = await screen.findByTestId("kosten-versionen-leer");
    expect(leer.textContent).toContain("Keine veröffentlichte Planversion");
    // Kein Snapshot-Knopf ohne Auswahl — sonst erzeugte ein Klick nichts und
    // die Ansicht saehe kaputt aus.
    expect(screen.queryByRole("button", { name: "Snapshot erzeugen" })).toBeNull();
  });

  it("A8 laedt die Auswahlliste und reicht den Bereich weiter", async () => {
    const { aufrufe } = zeige();
    await ladeVersionen("2026-W02", "2026-W50");

    await screen.findByTestId("kosten-versionen");
    expect(aufrufe.versionen).toEqual([{ fromWeekKey: "2026-W02", toWeekKey: "2026-W50" }]);
    const auswahl = screen.getByLabelText("Veröffentlichte Planversion");
    expect(auswahl.querySelectorAll("option")).toHaveLength(3); // inkl. "Bitte wählen"
  });

  it("A9 erzeugt den Snapshot aus der GEWAEHLTEN Version, ohne Baustellenfilter", async () => {
    const { aufrufe } = zeige();
    await ladeVersionen();
    await userEvent.selectOptions(await screen.findByLabelText("Veröffentlichte Planversion"), [
      VERSION_B,
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Snapshot erzeugen" }));

    await screen.findByTestId("kosten-snapshot");
    // VERSION_B, nicht die erste der Liste: ohne zwei Eintraege waere die
    // Auswahl nicht messbar.
    expect(aufrufe.erzeugt).toEqual([{ publishedPlanVersionId: VERSION_B, worksiteId: null }]);
    expect(aufrufe.schluessel).toHaveLength(1);
    expect(aufrufe.schluessel[0]).toMatch(/^[0-9a-f-]{36}$/);
    // Und die Adresse traegt den Snapshot — teilbar und reloadfest.
    expect(window.location.search).toBe(`?snapshot=${SNAPSHOT_ID}`);
  });

  it("A10 vergibt je Benutzerhandlung einen FRISCHEN Idempotenzschluessel", async () => {
    const { aufrufe } = zeige({ erzeugen: fehler("UNAVAILABLE") });
    await ladeVersionen();
    const auswahl = await screen.findByLabelText("Veröffentlichte Planversion");
    await userEvent.selectOptions(auswahl, [VERSION_A]);
    const knopf = screen.getByRole("button", { name: "Snapshot erzeugen" });
    await userEvent.click(knopf);
    await screen.findByTestId("kosten-snapshot-fehler");
    await userEvent.click(knopf);

    await waitFor(() => expect(aufrufe.schluessel).toHaveLength(2));
    // Derselbe Schluessel lieferte beim zweiten bewussten Versuch die ANTWORT
    // des ersten aus, statt es erneut zu versuchen.
    expect(aufrufe.schluessel[0]).not.toBe(aufrufe.schluessel[1]);
  });

  it("A11 zeigt waehrend des Erzeugens einen sichtbaren Zwischenzustand", async () => {
    zeige({ erzeugenHaengt: true });
    await ladeVersionen();
    await userEvent.selectOptions(await screen.findByLabelText("Veröffentlichte Planversion"), [
      VERSION_A,
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Snapshot erzeugen" }));

    expect((await screen.findByTestId("kosten-snapshot-erzeugt")).textContent).toContain(
      "Snapshot wird erstellt",
    );
    // Und der Knopf ist gesperrt: ein zweiter Klick erzeugte einen zweiten
    // Snapshot, und Snapshots lassen sich nicht loeschen.
    expect(
      screen.getByRole("button", { name: "Snapshot wird erstellt …" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  /**
   * Die fachlichen Ablehnungen des Servers — als TEXT, nicht als Farbe.
   *
   * Jeder Fall traegt den `detail` des Servers, weil dort die Handlung steht,
   * die den Fall behebt. Der URN wandert zusaetzlich als Attribut in den DOM:
   * damit ist im Browsertest pruefbar, WELCHE Ablehnung angezeigt wurde, ohne
   * einen deutschen Satz zu vergleichen.
   */
  it.each([
    [
      "urn:easytree:costs:rate-not-found",
      "Fuer Person X fehlt ein gueltiger Stundensatz. Bitte den Satz hinterlegen.",
    ],
    [
      "urn:easytree:costs:rate-ambiguous",
      "Fuer Person X gelten mehrere Stundensaetze gleichzeitig. Bitte bereinigen.",
    ],
    [
      "urn:easytree:costs:plan-not-published",
      "Diese Planversion ist ein Entwurf. Bitte zuerst veroeffentlichen.",
    ],
  ])("A12 zeigt die Ablehnung %s mit dem Text des Servers", async (type, detail) => {
    zeige({ erzeugen: fehler("REJECTED", problem(type, detail)) });
    await ladeVersionen();
    await userEvent.selectOptions(await screen.findByLabelText("Veröffentlichte Planversion"), [
      VERSION_A,
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Snapshot erzeugen" }));

    const meldung = await screen.findByTestId("kosten-snapshot-fehler");
    expect(meldung.textContent).toContain(detail);
    expect(meldung.getAttribute("data-problem-type")).toBe(type);
    // Und KEIN Snapshot: eine Ablehnung darf keine Zahlen stehen lassen.
    expect(screen.queryByTestId("kosten-snapshot")).toBeNull();
  });

  it.each<[GatewayFailure, string]>([
    ["FORBIDDEN", "costs.read"],
    ["UNAVAILABLE", "nicht erreichbar"],
    ["CONTRACT_VIOLATION", "unerwartet"],
    ["UNAUTHENTICATED", "abgelaufen"],
    ["STALE_VERSION", "veraltet"],
    ["REJECTED", "abgelehnt"],
  ])("A13 hat fuer %s einen eigenen Text ohne Problemdokument", async (grund, textstueck) => {
    zeige({ versionen: fehler(grund) });
    await ladeVersionen();

    const meldung = await screen.findByTestId("kosten-versionen-fehler");
    expect(meldung.textContent).toContain(textstueck);
  });

  it("A14 zeigt beim Lesefehler des gespeicherten Snapshots keine Zahlen", async () => {
    zeige(
      {
        lesen: fehler(
          "FORBIDDEN",
          problem(
            "urn:easytree:costs:snapshot-not-found",
            "Dieser Snapshot ist nicht verfuegbar. Bitte einen Snapshot aus der Liste waehlen.",
          ),
        ),
      },
      SNAPSHOT_ID,
    );

    const meldung = await screen.findByTestId("kosten-snapshot-fehler");
    expect(meldung.textContent).toContain("nicht verfuegbar");
    expect(screen.queryByTestId("kosten-gesamtsumme")).toBeNull();
  });

  it("A15 zeigt ohne Snapshot den ehrlichen Leerzustand", () => {
    zeige();
    expect(screen.getByTestId("kosten-kein-snapshot").textContent).toContain(
      "bewusst keine Zahlen",
    );
  });
});

/**
 * Die Baustellenauswahl (EYT-146).
 *
 * Die Fixturen sind auch hier die Gegenmutation: die Baustellen von VERSION_A
 * und VERSION_B sind disjunkt. Liesse die Ansicht beim Versionswechsel die alte
 * Auswahl stehen, reiste eine Baustelle der vorigen Version in den
 * Snapshot-Auftrag — und `A19` faellt genau darauf.
 */
describe("Kostenansicht — Baustellenauswahl (EYT-146)", () => {
  async function waehleVersion(version: string): Promise<void> {
    await userEvent.selectOptions(await screen.findByLabelText("Veröffentlichte Planversion"), [
      version,
    ]);
  }

  it("A16 fragt die Baustellen GENAU der gewaehlten Planversion an", async () => {
    const { aufrufe } = zeige({ baustellen: baustellenJeVersion });
    await ladeVersionen();
    // Vor der Auswahl darf nichts angefragt werden: es gibt keine Version, auf
    // die sich eine Baustellenliste beziehen koennte.
    expect(aufrufe.baustellen).toEqual([]);

    await waehleVersion(VERSION_B);
    await waitFor(() => expect(aufrufe.baustellen).toEqual([VERSION_B]));

    const auswahl = await screen.findByLabelText("Baustelle");
    // "Alle Baustellen" plus die EINE Baustelle von VERSION_B.
    expect(auswahl.querySelectorAll("option")).toHaveLength(2);
    expect(auswahl.textContent).toContain("Baustelle West");
    // Und keine aus der anderen Version.
    expect(auswahl.textContent).not.toContain("Baustelle Nord");
  });

  it("A17 sendet die KONKRET gewaehlte Baustelle an createSnapshot", async () => {
    const { aufrufe } = zeige({ baustellen: baustellenJeVersion });
    await ladeVersionen();
    await waehleVersion(VERSION_A);
    // Die ZWEITE Baustelle, nicht die erste: ohne zwei Eintraege waere die
    // Auswahl nicht von einem Vorgabewert zu unterscheiden.
    await userEvent.selectOptions(await screen.findByLabelText("Baustelle"), [BAUSTELLE_A_SUED]);
    await userEvent.click(screen.getByRole("button", { name: "Snapshot erzeugen" }));

    await screen.findByTestId("kosten-snapshot");
    expect(aufrufe.erzeugt).toEqual([
      { publishedPlanVersionId: VERSION_A, worksiteId: BAUSTELLE_A_SUED },
    ]);
  });

  it("A18 sendet fuer 'Alle Baustellen' ausdruecklich null", async () => {
    const { aufrufe } = zeige({ baustellen: baustellenJeVersion });
    await ladeVersionen();
    await waehleVersion(VERSION_A);
    // Erst eine konkrete Baustelle waehlen und dann zurueck auf "alle": ohne
    // den Rueckweg bewiese der Fall nur, dass der Anfangswert null ist.
    const auswahl = await screen.findByLabelText("Baustelle");
    await userEvent.selectOptions(auswahl, [BAUSTELLE_A_NORD]);
    await userEvent.selectOptions(auswahl, [""]);
    await userEvent.click(screen.getByRole("button", { name: "Snapshot erzeugen" }));

    await screen.findByTestId("kosten-snapshot");
    expect(aufrufe.erzeugt).toEqual([{ publishedPlanVersionId: VERSION_A, worksiteId: null }]);
  });

  it("A19 verwirft die Baustellenwahl beim Versionswechsel und laedt neu", async () => {
    const { aufrufe } = zeige({ baustellen: baustellenJeVersion });
    await ladeVersionen();
    await waehleVersion(VERSION_A);
    await userEvent.selectOptions(await screen.findByLabelText("Baustelle"), [BAUSTELLE_A_NORD]);

    await waehleVersion(VERSION_B);
    await waitFor(() => expect(aufrufe.baustellen).toEqual([VERSION_A, VERSION_B]));

    await userEvent.click(screen.getByRole("button", { name: "Snapshot erzeugen" }));
    await screen.findByTestId("kosten-snapshot");

    // Die eigentliche Aussage: die Baustelle der VORIGEN Version erreicht den
    // Auftrag nicht. Sie gehoert einer Planversion, die gar nicht gerechnet
    // wird — der Server lehnte sie ab, und die Ansicht haette es vorher wissen
    // koennen.
    expect(aufrufe.erzeugt).toEqual([{ publishedPlanVersionId: VERSION_B, worksiteId: null }]);
  });

  it("A20 zeigt den Ladezustand der Baustellen als TEXT", async () => {
    zeige({ baustellenHaengt: true });
    await ladeVersionen();
    await waehleVersion(VERSION_A);

    expect((await screen.findByTestId("kosten-baustellen-laedt")).textContent).toContain(
      "werden geladen",
    );
    // Solange die Auswahl unbekannt ist, wird nicht erzeugt: ein Snapshot ist
    // unveraenderlich und nicht loeschbar.
    expect(screen.getByRole("button", { name: "Snapshot erzeugen" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("A21 sagt es ehrlich, wenn die Version keine Baustelle nennt", async () => {
    const { aufrufe } = zeige({ baustellen: () => ({ ok: true, value: { worksites: [] } }) });
    await ladeVersionen();
    await waehleVersion(VERSION_A);

    const leer = await screen.findByTestId("kosten-baustellen-leer");
    expect(leer.textContent).toContain("keine Baustelle");
    // "Alle Baustellen" bleibt und ist NICHT dasselbe wie eine erfundene Zeile.
    const auswahl = screen.getByLabelText("Baustelle");
    expect(auswahl.querySelectorAll("option")).toHaveLength(1);
    expect(auswahl.textContent).toBe("Alle Baustellen");

    await userEvent.click(screen.getByRole("button", { name: "Snapshot erzeugen" }));
    await screen.findByTestId("kosten-snapshot");
    expect(aufrufe.erzeugt).toEqual([{ publishedPlanVersionId: VERSION_A, worksiteId: null }]);
  });

  it("A22 erzeugt NICHTS, wenn die Baustellenauswahl nicht geladen werden konnte", async () => {
    const { aufrufe } = zeige({
      baustellen: () =>
        fehler(
          "REJECTED",
          problem(
            "urn:easytree:costs:plan-not-published",
            "Diese Planversion ist ein Entwurf. Bitte zuerst veroeffentlichen.",
          ),
        ),
    });
    await ladeVersionen();
    await waehleVersion(VERSION_A);

    const meldung = await screen.findByTestId("kosten-baustellen-fehler");
    // Der Text des SERVERS, nicht ein hier nachgebauter.
    expect(meldung.textContent).toContain("Entwurf");
    expect(meldung.getAttribute("data-problem-type")).toBe("urn:easytree:costs:plan-not-published");

    // Und kein Erzeugen: ohne geladene Auswahl kann niemand informiert filtern,
    // und ein ungefilterter Snapshot waere eine stille Ersatzentscheidung.
    expect(screen.getByRole("button", { name: "Snapshot erzeugen" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(aufrufe.erzeugt).toEqual([]);
  });

  it("A23 fragt nach dem Zuruecksetzen auf 'Bitte wählen' keine Baustellen an", async () => {
    const { aufrufe } = zeige({ baustellen: baustellenJeVersion });
    await ladeVersionen();
    await waehleVersion(VERSION_A);
    await waitFor(() => expect(aufrufe.baustellen).toEqual([VERSION_A]));

    await userEvent.selectOptions(screen.getByLabelText("Veröffentlichte Planversion"), [""]);
    // Keine zweite Anfrage mit leerer Id — die waere garantiert ein 400.
    expect(aufrufe.baustellen).toEqual([VERSION_A]);
    expect(screen.queryByLabelText("Baustelle")).toBeNull();
  });

  it("A24 verwirft die Baustellenwahl auch beim erneuten Laden des Wochenbereichs", async () => {
    const { aufrufe } = zeige({ baustellen: baustellenJeVersion });
    await ladeVersionen();
    await waehleVersion(VERSION_A);
    await userEvent.selectOptions(await screen.findByLabelText("Baustelle"), [BAUSTELLE_A_NORD]);

    // Ein neuer Wochenbereich setzt schon die Planversion zurueck. Bliebe die
    // Baustelle stehen, haette der naechste Snapshot einen Filter, den niemand
    // fuer ihn gewaehlt hat.
    await userEvent.click(screen.getByRole("button", { name: "Planversionen laden" }));
    await screen.findByTestId("kosten-versionen");
    expect(screen.queryByLabelText("Baustelle")).toBeNull();

    await waehleVersion(VERSION_A);
    await userEvent.click(screen.getByRole("button", { name: "Snapshot erzeugen" }));
    await screen.findByTestId("kosten-snapshot");
    expect(aufrufe.erzeugt).toEqual([{ publishedPlanVersionId: VERSION_A, worksiteId: null }]);
  });
});
