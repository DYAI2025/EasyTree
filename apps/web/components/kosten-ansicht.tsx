"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  PublishedPlanVersionsQuerySchema,
  newIdempotencyKey,
  type CostSnapshot,
  type GatewayFailure,
  type ProblemDocument,
  type SelectablePlanVersion,
} from "@easytree/contracts";
import { Button, Card, EmptyState, ErrorState, PrimaryAction, StateBanner } from "@easytree/ui";

import { useCostsGateway } from "../lib/costs-gateway-provider";
import { minorUnitsToEuro } from "../lib/euro-minor-units";

/**
 * Die Kostenansicht (EYT-109/EYT-144): vom veroeffentlichten Plan bis zur
 * einzelnen gespeicherten Kostenposition.
 *
 * ## Der Client rechnet NICHT
 *
 * Jede Zahl dieser Ansicht stammt woertlich aus dem gespeicherten Snapshot:
 * `totalMinorUnits` als Gesamtsumme, `days[].amountMinorUnits` je Tag,
 * `positions[].amountMinorUnits` je Position. Es gibt hier keine Addition,
 * kein `Number(...)`, kein `parseFloat` und keine Gleitkommazahl — Betraege
 * reisen als Ziffernfolge und werden ausschliesslich formatiert.
 *
 * Das ist keine Stilfrage. Summierte die Oberflaeche selbst, waere die
 * angezeigte Gesamtsumme eine ZWEITE Wahrheit neben der gespeicherten, und bei
 * einer spaeteren Filterung oder Paginierung waere sie die falsche. Der Test
 * `kosten-ansicht.test.tsx` fuettert deshalb einen Snapshot, dessen
 * `totalMinorUnits` den Positionen absichtlich WIDERSPRICHT; angezeigt werden
 * muss der gespeicherte Kopfwert.
 *
 * ## Der Reload-Vertrag
 *
 * Wird `/kosten?snapshot=<id>` geoeffnet, ruft diese Ansicht ausschliesslich
 * `snapshot(id)`. Kein `createSnapshot`, keine Neuberechnung, kein Laden
 * aktueller Saetze. Ein Snapshot ist ein historisches Dokument: ihn beim
 * Ansehen neu zu rechnen hiesse, ihn zu veraendern.
 *
 * ## Die Baustellenauswahl fehlt mit Absicht
 *
 * `createSnapshot` sendet `worksiteId: null` — alle Baustellen. Eine Auswahl
 * braeuchte eine Baustellenliste, die es als API nicht gibt; sie zu erfinden
 * oder rohe UUIDs abzufragen waere schlechter als sie wegzulassen. Der
 * serverseitige Filter bleibt unveraendert bestehen und kann spaeter eine
 * eigene Scheibe bekommen.
 */

/** Fallbacktexte — greifen nur, wenn der Server KEIN Problemdokument schickte. */
const FEHLERTEXT: Record<GatewayFailure, string> = {
  UNAUTHENTICATED: "Die Sitzung ist abgelaufen. Bitte neu anmelden.",
  FORBIDDEN: "Deine Rolle darf Kostendaten nicht einsehen (costs.read fehlt).",
  UNAVAILABLE: "Der Server ist nicht erreichbar. Es wurde nichts gespeichert.",
  CONTRACT_VIOLATION: "Die Antwort des Servers war unerwartet. Es wird bewusst nichts angezeigt.",
  STALE_VERSION: "Der Stand war veraltet. Bitte die Auswahl neu laden.",
  REJECTED: "Der Server hat die Anfrage abgelehnt. Bitte die Eingaben pruefen.",
};

/**
 * Der anzuzeigende Text — der des SERVERS, wenn es einen gibt.
 *
 * `problem.detail` ist bereits eine Handlungsanweisung („bitte zuerst
 * veroeffentlichen", „bitte den Satz hinterlegen"), und sie unterscheidet
 * Faelle, die der Client gar nicht unterscheiden koennte: fehlender Satz,
 * mehrdeutiger Satz und unveroeffentlichter Plan kommen alle als 409 an.
 * Sie hier anhand des URN nachzubauen hiesse, dieselbe Tabelle ein zweites Mal
 * zu fuehren — und die Kopie wuerde bei der naechsten Serveraenderung falsch.
 */
function fehlertext(grund: GatewayFailure, problem: ProblemDocument | null): string {
  return problem === null ? FEHLERTEXT[grund] : problem.detail;
}

/**
 * Millisekunden als `h:mm` — in `bigint`, ohne eine einzige Gleitkommazahl.
 *
 * Dieselbe Regel wie bei Betraegen: die Dauer reist als Ziffernfolge, weil sie
 * oberhalb von 2^53 sonst still an Genauigkeit verloere. `Number(...)` waere
 * hier heute unauffaellig und morgen der Fehler, den niemand sucht.
 */
function alsDauer(millisekunden: string): string {
  const minuten = BigInt(millisekunden) / 60000n;
  const stunden = minuten / 60n;
  const rest = minuten % 60n;
  return `${stunden}:${String(rest).padStart(2, "0")} h`;
}

/** Anzeige eines UTC-Instants in einer EXPLIZITEN Zone (Regel: no-local-time). */
function alsZeitpunkt(instant: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(instant));
}

type ListenZustand =
  | { art: "bereit" }
  | { art: "laedt" }
  | { art: "fehler"; grund: GatewayFailure; problem: ProblemDocument | null }
  | { art: "geladen"; versionen: readonly SelectablePlanVersion[] };

type SnapshotZustand =
  | { art: "keiner" }
  | { art: "laedt" }
  | { art: "erzeugt" }
  | { art: "fehler"; grund: GatewayFailure; problem: ProblemDocument | null }
  | { art: "geladen"; snapshot: CostSnapshot };

export function KostenAnsicht({ snapshotId }: { snapshotId: string | null }) {
  const gateway = useCostsGateway();
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [eingabefehler, setEingabefehler] = useState<string | null>(null);
  const [liste, setListe] = useState<ListenZustand>({ art: "bereit" });
  const [gewaehlt, setGewaehlt] = useState("");
  const [snapshot, setSnapshot] = useState<SnapshotZustand>(
    snapshotId === null ? { art: "keiner" } : { art: "laedt" },
  );

  // Der Reload-Vertrag: NUR lesen. Diese Wirkung ruft `snapshot(id)` und sonst
  // nichts — kein Erzeugen, keine Saetze, keine Planversionen.
  useEffect(() => {
    if (snapshotId === null) return;
    let abgebrochen = false;
    setSnapshot({ art: "laedt" });
    void gateway.snapshot(snapshotId).then((ergebnis) => {
      if (abgebrochen) return;
      setSnapshot(
        ergebnis.ok
          ? { art: "geladen", snapshot: ergebnis.value }
          : { art: "fehler", grund: ergebnis.failure, problem: ergebnis.problem },
      );
    });
    return () => {
      abgebrochen = true;
    };
  }, [gateway, snapshotId]);

  const ladeVersionen = useCallback(
    async (ereignis: FormEvent<HTMLFormElement>) => {
      ereignis.preventDefault();
      // Dieselbe Regel wie im Gateway, hier aber MIT anzeigbarer Meldung: das
      // Gateway kann nur `CONTRACT_VIOLATION` ohne Text liefern, weil ein dort
      // erfundenes Problemdokument auf nichts zeigte.
      const geprueft = PublishedPlanVersionsQuerySchema.safeParse({
        fromWeekKey: von,
        toWeekKey: bis,
      });
      if (!geprueft.success) {
        setEingabefehler(
          "Bitte zwei gültige Kalenderwochen angeben — die erste Woche darf nicht nach der zweiten liegen.",
        );
        setListe({ art: "bereit" });
        return;
      }
      setEingabefehler(null);
      setGewaehlt("");
      setListe({ art: "laedt" });
      const ergebnis = await gateway.publishedPlanVersions(geprueft.data);
      setListe(
        ergebnis.ok
          ? { art: "geladen", versionen: ergebnis.value.versions }
          : { art: "fehler", grund: ergebnis.failure, problem: ergebnis.problem },
      );
    },
    [gateway, von, bis],
  );

  const erzeuge = useCallback(async () => {
    if (gewaehlt === "") return;
    setSnapshot({ art: "erzeugt" });
    const ergebnis = await gateway.createSnapshot(
      { publishedPlanVersionId: gewaehlt, worksiteId: null },
      // Ein FRISCHER Schluessel je Benutzerhandlung. Derselbe Schluessel fuer
      // zwei bewusst ausgeloeste Vorgaenge lieferte den ersten Snapshot noch
      // einmal aus, statt den zweiten zu erzeugen.
      { idempotencyKey: newIdempotencyKey() },
    );
    if (!ergebnis.ok) {
      setSnapshot({ art: "fehler", grund: ergebnis.failure, problem: ergebnis.problem });
      return;
    }
    // Der zurueckgelesene GESPEICHERTE Stand, nicht die Eingabe.
    setSnapshot({ art: "geladen", snapshot: ergebnis.value });
    // Die Adresse teilbar machen, OHNE zu navigieren: ein `router.push` liesse
    // die Seite neu laden und den gerade gelesenen Stand ein zweites Mal holen.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `?snapshot=${encodeURIComponent(ergebnis.value.id)}`);
    }
  }, [gateway, gewaehlt]);

  return (
    <div className="eyt-kosten-ansicht">
      <Card title="Planversion wählen">
        <form className="eyt-form" onSubmit={ladeVersionen} data-testid="kosten-wochenformular">
          <div className="eyt-form__row">
            <div className="eyt-form__field">
              <label htmlFor="kosten-von">Von Woche</label>
              <input
                id="kosten-von"
                name="vonWoche"
                type="week"
                required
                placeholder="2026-W32"
                value={von}
                onChange={(e) => setVon(e.target.value)}
                disabled={liste.art === "laedt"}
              />
            </div>
            <div className="eyt-form__field">
              <label htmlFor="kosten-bis">Bis Woche</label>
              <input
                id="kosten-bis"
                name="bisWoche"
                type="week"
                required
                placeholder="2026-W32"
                value={bis}
                onChange={(e) => setBis(e.target.value)}
                disabled={liste.art === "laedt"}
              />
            </div>
          </div>

          {eingabefehler === null ? null : (
            <StateBanner tone="warning" title="Eingabe prüfen" data-testid="kosten-eingabefehler">
              {eingabefehler}
            </StateBanner>
          )}

          {/* Bewusst KEIN `PrimaryAction`: der primaere CTA dieser Ansicht ist
              „Snapshot erzeugen". Zwei primaere Aktionen auf einem Screen
              verstiessen gegen Basisdesign v2.0 §2.3 — und die Wochenauswahl
              ist der Weg dorthin, nicht das Ziel. */}
          <Button type="submit" variant="ghost" disabled={liste.art === "laedt"}>
            {liste.art === "laedt" ? "Planversionen werden geladen …" : "Planversionen laden"}
          </Button>
        </form>

        {liste.art === "laedt" ? (
          <p role="status" data-testid="kosten-versionen-laedt">
            Veröffentlichte Planversionen werden geladen …
          </p>
        ) : null}

        {liste.art === "fehler" ? (
          <ErrorState
            data-testid="kosten-versionen-fehler"
            title="Planversionen nicht verfügbar"
            description={fehlertext(liste.grund, liste.problem)}
          />
        ) : null}

        {liste.art === "geladen" && liste.versionen.length === 0 ? (
          <EmptyState
            data-testid="kosten-versionen-leer"
            title="Keine veröffentlichte Planversion in diesem Zeitraum"
            description="Kosten entstehen ausschließlich aus einer veröffentlichten Planung. Bitte die Woche in der Planung veröffentlichen oder einen anderen Zeitraum wählen."
          />
        ) : null}

        {liste.art === "geladen" && liste.versionen.length > 0 ? (
          <div className="eyt-form__field" data-testid="kosten-versionen">
            <label htmlFor="kosten-planversion">Veröffentlichte Planversion</label>
            <select
              id="kosten-planversion"
              value={gewaehlt}
              onChange={(e) => setGewaehlt(e.target.value)}
              disabled={snapshot.art === "erzeugt"}
            >
              <option value="">Bitte wählen</option>
              {liste.versionen.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.weekKey} — veröffentlicht {alsZeitpunkt(version.publishedAt)}
                </option>
              ))}
            </select>
            <PrimaryAction
              type="button"
              onClick={() => void erzeuge()}
              disabled={gewaehlt === "" || snapshot.art === "erzeugt"}
            >
              {snapshot.art === "erzeugt" ? "Snapshot wird erstellt …" : "Snapshot erzeugen"}
            </PrimaryAction>
          </div>
        ) : null}
      </Card>

      <Card title="Gespeicherter Kosten-Snapshot">
        {snapshot.art === "keiner" ? (
          <EmptyState
            data-testid="kosten-kein-snapshot"
            title="Noch kein Snapshot gewählt"
            description="Wähle oben einen Zeitraum, dann eine veröffentlichte Planversion und erzeuge daraus einen Snapshot. Bis dahin zeigt easyTree hier bewusst keine Zahlen."
          />
        ) : null}

        {snapshot.art === "laedt" ? (
          <p role="status" data-testid="kosten-snapshot-laedt">
            Gespeicherter Snapshot wird geladen …
          </p>
        ) : null}

        {snapshot.art === "erzeugt" ? (
          <p role="status" data-testid="kosten-snapshot-erzeugt">
            Snapshot wird erstellt …
          </p>
        ) : null}

        {snapshot.art === "fehler" ? (
          <ErrorState
            data-testid="kosten-snapshot-fehler"
            data-problem-type={snapshot.problem?.type ?? ""}
            title="Kein Snapshot"
            description={fehlertext(snapshot.grund, snapshot.problem)}
          />
        ) : null}

        {snapshot.art === "geladen" ? <SnapshotAnzeige snapshot={snapshot.snapshot} /> : null}
      </Card>
    </div>
  );
}

/**
 * Der gespeicherte Stand — Kopf, Tagessummen, Positionen.
 *
 * Jede Zahl kommt aus dem Snapshot. Die Herkunftsangaben (Regelversion, Zone,
 * Korrelations-Id, Erzeuger) stehen dabei nicht aus Vollstaendigkeitsdrang
 * dort: ohne sie ist spaeter nicht mehr entscheidbar, nach welcher Regel und
 * in welcher Zone die Tagesgrenzen gezogen wurden.
 */
function SnapshotAnzeige({ snapshot }: { snapshot: CostSnapshot }) {
  return (
    <div data-testid="kosten-snapshot" data-snapshot-id={snapshot.id}>
      <dl className="eyt-kennzahlen">
        <div>
          <dt>Snapshot-ID</dt>
          <dd data-testid="kosten-snapshot-id">{snapshot.id}</dd>
        </div>
        <div>
          <dt>Planversion</dt>
          <dd data-testid="kosten-planversion-id">{snapshot.planVersionId}</dd>
        </div>
        <div>
          <dt>Woche</dt>
          <dd>{snapshot.weekKey}</dd>
        </div>
        <div>
          <dt>Erzeugt am</dt>
          <dd>{alsZeitpunkt(snapshot.createdAt)}</dd>
        </div>
        <div>
          <dt>Erzeugt von</dt>
          {/* Die wahrheitsgemaesse Id. Es gibt keine Namensaufloesung fuer
              Benutzer-Ids in diesem Vertrag — einen Namen zu erfinden waere
              schlimmer als eine Id zu zeigen, die sich nachschlagen laesst. */}
          <dd data-testid="kosten-erzeuger">{snapshot.createdBy}</dd>
        </div>
        <div>
          <dt>Regelversion</dt>
          <dd data-testid="kosten-regelversion">{snapshot.ruleVersion}</dd>
        </div>
        <div>
          <dt>Zeitzone</dt>
          <dd>{snapshot.timeZone}</dd>
        </div>
        <div>
          <dt>Währung</dt>
          <dd data-testid="kosten-waehrung">{snapshot.currency}</dd>
        </div>
        <div>
          <dt>Baustellenfilter</dt>
          <dd data-testid="kosten-baustellenfilter">{snapshot.worksiteId ?? "alle Baustellen"}</dd>
        </div>
      </dl>

      <p className="eyt-kosten-summe">
        <strong>Gesamtsumme: </strong>
        <span data-testid="kosten-gesamtsumme">
          {minorUnitsToEuro(snapshot.totalMinorUnits)} {snapshot.currency}
        </span>
      </p>

      <div className="eyt-table-scroll">
        <table className="eyt-table" data-testid="kosten-tage">
          <caption className="eyt-table__caption">
            Tagessummen dieses Snapshots. Die Beträge stammen unverändert aus dem gespeicherten
            Stand — easyTree rechnet sie in der Ansicht nicht nach.
          </caption>
          <thead>
            <tr>
              <th scope="col">Tag</th>
              <th scope="col">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.days.map((tag) => (
              <tr key={tag.localDate} data-testid="kosten-tag" data-local-date={tag.localDate}>
                <td>{tag.localDate}</td>
                <td className="eyt-table__amount">
                  {minorUnitsToEuro(tag.amountMinorUnits)} {snapshot.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="eyt-table-scroll">
        <table className="eyt-table" data-testid="kosten-positionen">
          <caption className="eyt-table__caption">
            Einzelpositionen in der eingefrorenen Reihenfolge des Snapshots. Jede Zeile nennt die
            Satzversion, mit der sie bewertet wurde.
          </caption>
          <thead>
            <tr>
              <th scope="col">Baustelle</th>
              <th scope="col">Tag</th>
              <th scope="col">Person</th>
              <th scope="col">Dauer</th>
              <th scope="col">Satzversion</th>
              <th scope="col">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.positions.map((position) => (
              <tr
                key={position.id}
                data-testid="kosten-position"
                data-position-id={position.id}
                data-amount-minor-units={position.amountMinorUnits}
              >
                <td>{position.worksiteLabel}</td>
                <td>{position.localDate}</td>
                <td>{position.employeeLabel}</td>
                <td>{alsDauer(position.durationMilliseconds)}</td>
                <td>{position.rateVersionId}</td>
                <td className="eyt-table__amount">
                  {minorUnitsToEuro(position.amountMinorUnits)} {snapshot.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
