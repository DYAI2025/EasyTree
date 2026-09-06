"use client";

/**
 * Wochenarbeitsflaeche der Dispositionswerkbank (EYT-50, umgebaut in EYT-147).
 *
 * ## Von der Liste zur Woche (EYT-147 Slice 1)
 *
 * Bis EYT-147 zeigte diese Ansicht die Einsaetze als flache Liste unter einer
 * Ueberschrift — fachlich korrekt, aber als FORMULARSEITE lesbar, nicht als
 * Planung. Jetzt ist die Woche die Flaeche: sieben Kalendertage als raeumliche
 * Achse. Seit EYT-158 ist jeder serverseitige Baustellentag genau eine Karte;
 * sein Einsatzteam steht darunter. Legacy-Einplanungen bleiben getrennt
 * sichtbar, ohne daraus eine Tagesidentität zu erfinden. `lib/wochenraster.ts`
 * ordnet diese Legacy-Zeiten ausschliesslich mit Domain-Helfern zu.
 *
 * ## Vier Zustaende, alle sichtbar
 *
 * laden, leer, Fehler, Erfolg. Der Fehlerzustand ist der wichtigste: er zeigt
 * den Grund aus dem Port (`GatewayFailure`) an, statt eine leere Woche zu
 * rendern. Eine leere Woche und eine fehlgeschlagene Abfrage sehen sonst
 * identisch aus, und der Ausfall wuerde als "nichts geplant" gelesen. Neu seit
 * EYT-147: auch die TAGESZUORDNUNG faellt sichtbar aus — ist Zone oder Woche
 * unbestimmbar, steht die flache Liste mit Hinweis da, nie ein leeres Raster.
 *
 * ## Kein Fallback
 *
 * Es gibt keinen Zweig, der bei einem Fehler Testdaten oder einen zuletzt
 * bekannten Stand aus dem Browser zeigt. EYT-50 AK10 verlangt ausdruecklich,
 * dass kein Mock- oder LocalStorage-Zustand operative Wahrheit ist — und ein
 * Fallback macht aus einem sichtbaren Ausfall eine plausible Anzeige.
 *
 * ## Warum die IDs sichtbar sind
 *
 * `data-assignment-id` und `data-published-version-id` stehen im Markup, weil
 * AK9 verlangt, dass Planer- und Mitarbeiteransicht DIESELBEN serverseitig
 * vergebenen Ids zeigen. Ohne sie liesse sich das nur ueber Text vergleichen,
 * und Text ist Darstellung. Jede Zuweisung traegt ihre Id auf GENAU EINEM
 * Element (`werkbank-serverwahrheit.test.tsx` zaehlt exakt), und jede Karte
 * ist ein `li` — daran haengen `getAllByRole("listitem")`-Zusicherungen.
 *
 * ## Der Inspector ist ein Ort, kein zweiter Zustand
 *
 * `WorksiteDayForm` steht in einem seitlichen, NICHTMODALEN Inspector,
 * geoeffnet ueber „Baustellentag anlegen". Erfolg setzt sowohl den Write
 * als auch den passenden Readback voraus. Währenddessen bleibt das Formular
 * sichtbar, ohne einen Erfolg vorwegzunehmen. Kein Fokus-Trap: Escape schliesst, der
 * Fokus kehrt zur ausloesenden Schaltflaeche zurueck.
 *
 * ## Genau eine primaere Aktion (Basisdesign §2.3, EYT-147 §8.8)
 *
 * Traegt die Woche einen veroeffentlichbaren Entwurf und die Rolle das Recht,
 * ist „Plan veroeffentlichen" DIE primaere Aktion (sie kommt aus
 * `PlanningPublishAction`). Nur dann ist „Baustellentag anlegen" eine gewoehnliche
 * Schaltflaeche; sonst ist es selbst die primaere. `auth-journey` zaehlt
 * `.eyt-primary-action` auf /planung und erwartet hoechstens eine.
 */
import {
  newIdempotencyKey,
  type GatewayFailure,
  type IdempotencyKey,
  type PlanningResource,
  type PlanningWindow,
} from "@easytree/contracts";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PrimaryAction,
  StateBanner,
  StatusBadge,
  VisuallyHidden,
  type StatusTone,
} from "@easytree/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { usePlanningGateway } from "../lib/planning-gateway-provider";
import { wochenraster, zeitText } from "../lib/wochenraster";
import type { AssignmentDto, WorksiteDayDto } from "@easytree/contracts";
import { WorksiteDayForm, type WorksiteDayInput } from "./planning-worksite-day-form";
import { PlanningPublishAction } from "./planning-publish-action";

type ViewState =
  | { readonly kind: "laedt" }
  | { readonly kind: "fehler"; readonly failure: GatewayFailure }
  | { readonly kind: "geladen"; readonly window: PlanningWindow };

/** Deutscher Text je Portfehler. Bewusst vollstaendig — kein Standardzweig. */
const FAILURE_TEXT: Record<GatewayFailure, string> = {
  UNAVAILABLE: "Der Server ist nicht erreichbar.",
  CONTRACT_VIOLATION: "Die Antwort des Servers entspricht nicht dem Vertrag.",
  UNAUTHENTICATED: "Nicht angemeldet.",
  FORBIDDEN: "Keine Berechtigung für diese Organisation.",
  STALE_VERSION: "Der Stand ist veraltet.",
  REJECTED: "Die Anfrage wurde abgelehnt.",
};

/**
 * Welcher Zustandsbaustein einen Portfehler traegt (EYT-141).
 *
 * Nicht jeder Fehlschlag ist ein Fehler im Sinne der Bedienung:
 *
 * - `kein-zugriff` ist ein RECHTEzustand. Ein „Erneut versuchen" waere dort
 *   eine Luege — dieselbe Anfrage scheitert wieder, und die Nutzerin wuerde
 *   klicken statt sich anzumelden bzw. die Organisation zu wechseln.
 * - `veraltet` ist ein Nebenlaeufigkeitszustand: der Server hat recht, der
 *   Bildschirm ist alt. Warnend, nicht alarmierend.
 * - alles Uebrige ist ein echter Ausfall — assertiv, mit Weg zurueck.
 *
 * Vollstaendiges `Record`, kein Standardzweig: kommt ein `GatewayFailure`
 * hinzu, geht der Typecheck rot, statt den neuen Fall still als Ausfall zu
 * zeigen.
 */
type Zustandsklasse = "ausfall" | "kein-zugriff" | "veraltet";

const ZUSTANDSKLASSE: Record<GatewayFailure, Zustandsklasse> = {
  UNAVAILABLE: "ausfall",
  CONTRACT_VIOLATION: "ausfall",
  UNAUTHENTICATED: "kein-zugriff",
  FORBIDDEN: "kein-zugriff",
  STALE_VERSION: "veraltet",
  REJECTED: "ausfall",
};

/**
 * Die vier Staende, die AK10 sichtbar unterscheiden muss.
 *
 * `sourceVersion` und `publishedVersionId` sind getrennt, weil beides
 * gleichzeitig gelten kann: ein Entwurf ueber einer bereits veroeffentlichten
 * Woche ist der Normalfall beim Umplanen. Ohne die Unterscheidung stuende
 * "Veroeffentlichte Version X" ueber Zuweisungen, die nicht zu X gehoeren.
 */
type Stand = "ohne-version" | "entwurf" | "veroeffentlicht" | "entwurf-ueber-veroeffentlicht";

/**
 * Erlaeuternder Zusatz NEBEN dem Abzeichen — nur dort, wo er etwas sagt, was
 * das Abzeichen nicht schon sagt (PO-Review-Reparatur EYT-147). „Entwurf" mit
 * dem Satz „Unveroeffentlichter Entwurf." daneben war dieselbe Aussage
 * zweimal; `null` heisst: das Abzeichen ist die ganze Aussage.
 */
const STAND_TEXT: Record<Stand, string | null> = {
  "ohne-version": "Für diese Woche existiert noch keine Planversion.",
  entwurf: null,
  veroeffentlicht: null,
  "entwurf-ueber-veroeffentlicht":
    "Entwurf auf Basis einer bereits veröffentlichten Version — angezeigt wird der Entwurf.",
};

/**
 * Kurzform des Standes als Abzeichen (EYT-140 M7, `AC-008`/`AC-018`).
 *
 * Das Abzeichen ist seit der PO-Review-Reparatur die EINE primaere
 * Statusanzeige der Werkbank (`werkbank-oberflaechenguards.test.tsx` zaehlt
 * die `StatusBadge`-Elemente). `StatusBadge` setzt je Ton eine eigene
 * Glyphe (`●`, `◐`, `○`), sodass Entwurf und veroeffentlichter Stand auch ohne
 * Farbwahrnehmung unterscheidbar bleiben — Basisdesign v2.0 §7 verlangt genau
 * das, und eine reine CSS-Klasse erfuellt es nicht.
 *
 * `entwurf-ueber-veroeffentlicht` bekommt bewusst denselben Ton wie `entwurf`:
 * angezeigt wird der ENTWURF, und ein veroeffentlicht-Ton daneben waere die
 * Verwechslung, die `standKennung` gerade verhindert.
 */
const STAND_TON: Record<Stand, StatusTone> = {
  "ohne-version": "neutral",
  entwurf: "draft",
  veroeffentlicht: "published",
  "entwurf-ueber-veroeffentlicht": "draft",
};

const STAND_ABZEICHEN: Record<Stand, string> = {
  "ohne-version": "Keine Version",
  entwurf: "Entwurf",
  veroeffentlicht: "Veröffentlicht",
  "entwurf-ueber-veroeffentlicht": "Entwurf",
};

function standKennung(fenster: PlanningWindow): Stand {
  if (fenster.sourceVersion === null) return "ohne-version";
  if (fenster.sourceVersion.state === "published") return "veroeffentlicht";
  return fenster.publishedVersionId === null ? "entwurf" : "entwurf-ueber-veroeffentlicht";
}

/**
 * Anzeigename einer Id aus `resources`.
 *
 * Faellt bewusst auf die Id zurueck statt auf "Unbekannt": eine Id, zu der es
 * keinen Namen gibt, ist ein Befund und soll sichtbar bleiben. In der Praxis
 * tritt der Zweig nicht auf — `PlanningWindowSchema` verwirft eine solche
 * Antwort bereits — er ist die letzte Verteidigungslinie, nicht die erste.
 */
function anzeigename(eintraege: readonly PlanningResource[], id: string): string {
  const treffer = eintraege.find((eintrag) => eintrag.id === id);
  if (treffer === undefined) return id;
  return treffer.active ? treffer.label : `${treffer.label} (inaktiv)`;
}

/**
 * Untergeordnete Legacy-Zeile ohne WorksiteDay-Identität. Die technische Id
 * liegt auf GENAU diesem `li`, nicht als sichtbarer Produktname vor.
 */
function Einsatzkarte({ einsatz, fenster }: { einsatz: AssignmentDto; fenster: PlanningWindow }) {
  return (
    <li
      className="legacy-einplanung"
      data-assignment-id={einsatz.id}
      data-employee-id={einsatz.employeeId}
      data-worksite-id={einsatz.worksiteId}
    >
      <span className="einsatzkarte__zeit">
        {zeitText(einsatz.interval.startUtc, fenster.timeZone)}
        {"–"}
        {zeitText(einsatz.interval.endUtc, fenster.timeZone)}
      </span>
      <strong className="einsatzkarte__baustelle">
        {anzeigename(fenster.resources.worksites, einsatz.worksiteId)}
      </strong>
      <span className="einsatzkarte__person">
        {anzeigename(fenster.resources.employees, einsatz.employeeId)}
      </span>
    </li>
  );
}

/**
 * Der lokale Tag als deutsches Datum („Mo., 10.01.2028"), nicht als ISO-String:
 * die Spalte nennt den Wochentag schon, die Karte muss auch „Außerhalb dieser
 * Woche" lesbar bleiben. `dateTime` traegt weiter den maschinenlesbaren Wert.
 */
function datumsText(localDate: string): string {
  const [jahr, monat, tag] = localDate.split("-").map(Number);
  if (jahr === undefined || monat === undefined || tag === undefined) return localDate;
  if (!Number.isInteger(jahr) || !Number.isInteger(monat) || !Number.isInteger(tag)) {
    return localDate;
  }
  try {
    return new Intl.DateTimeFormat("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(jahr, monat - 1, tag)));
  } catch {
    return localDate;
  }
}

/** Die Tagesidentität kommt ausschließlich aus dem Server-Readmodel. */
function WorksiteDayCard({ day, fenster }: { day: WorksiteDayDto; fenster: PlanningWindow }) {
  const teamTitelId = useId();
  const times = [
    ...new Set(
      day.team.map(
        (member) =>
          `${zeitText(member.interval.startUtc, fenster.timeZone)}–${zeitText(member.interval.endUtc, fenster.timeZone)}`,
      ),
    ),
  ];
  return (
    <li
      className="einsatzkarte"
      data-worksite-day-id={day.worksiteDayId}
      data-configuration-id={day.configurationId}
      data-worksite-id={day.worksiteId}
    >
      <strong className="einsatzkarte__baustelle">
        {anzeigename(fenster.resources.worksites, day.worksiteId)}
      </strong>
      <time className="einsatzkarte__datum" dateTime={day.localDate}>
        {datumsText(day.localDate)}
      </time>
      {day.team.length === 0 ? (
        // Ein Tag ohne Besetzung ist ein Tag ohne Team — nicht „ohne
        // Arbeitszeit": die Zeit haengt an den Personen.
        <span className="einsatzkarte__zeit">Noch kein Einsatzteam</span>
      ) : (
        <>
          <span className="einsatzkarte__zeit">{times.join(", ")}</span>
          <span id={teamTitelId} className="einsatzkarte__teamtitel">
            Einsatzteam
          </span>
        </>
      )}
      <ul
        className="einsatzkarte__team"
        aria-labelledby={day.team.length === 0 ? undefined : teamTitelId}
      >
        {day.team.map((member) => (
          <li
            key={member.assignmentId}
            data-assignment-id={member.assignmentId}
            data-employee-id={member.employeeId}
            data-worksite-id={day.worksiteId}
          >
            {anzeigename(fenster.resources.employees, member.employeeId)}
          </li>
        ))}
      </ul>
    </li>
  );
}

function Tagesplanung({
  days,
  assignments,
  fenster,
  ueberschrift: Ueberschrift = "h4",
}: {
  days: readonly WorksiteDayDto[];
  assignments: readonly AssignmentDto[];
  fenster: PlanningWindow;
  /**
   * Ebene der Legacy-Ueberschrift. In der Tageszelle (h3) ist es h4; in der
   * Rueckfallliste ohne Tageszellen haengt sie direkt unter der h2 und muss
   * h3 sein — axe `heading-order` laesst keine Stufe ueberspringen.
   */
  ueberschrift?: "h3" | "h4";
}) {
  const teamIds = new Set(
    fenster.worksiteDays?.flatMap((day) => day.team.map((member) => member.assignmentId)),
  );
  const legacy = assignments.filter((assignment) => !teamIds.has(assignment.id));
  return (
    <>
      {days.length > 0 ? (
        <ul className="wochenraster__einsaetze">
          {days.map((day) => (
            <WorksiteDayCard key={day.worksiteDayId} day={day} fenster={fenster} />
          ))}
        </ul>
      ) : null}
      {legacy.length > 0 ? (
        // Bewusst KEIN aria-label: mit Namen waere jede Tageszelle eine
        // gleichnamige Region-Landmark; die Ueberschrift traegt die Struktur.
        <section className="wochenraster__legacy">
          <Ueberschrift>Einplanungen ohne Baustellentag</Ueberschrift>
          <ul className="wochenraster__einsaetze">
            {legacy.map((einsatz) => (
              <Einsatzkarte key={einsatz.id} einsatz={einsatz} fenster={fenster} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export function PlanningWindowView({
  weekKey,
  darfVeroeffentlichen = false,
}: {
  weekKey: string;
  /**
   * Steuert nur die ANZEIGE der Publish-Aktion; autorisiert wird
   * serverseitig. Kommt als Prop von `PlanungZugang` statt aus dem
   * Sitzungskontext: diese Ansicht soll ohne Sitzungsinfrastruktur pruefbar
   * bleiben, und ein zweiter `useSession`-Aufruf waere eine zweite Stelle,
   * an der dieselbe Frage anders beantwortet werden koennte.
   *
   * Vorgabe `false` — fail-closed: wer die Prop vergisst, bekommt keine
   * Aktion, nicht eine unbeaufsichtigte.
   */
  darfVeroeffentlichen?: boolean;
}) {
  const gateway = usePlanningGateway();
  const [state, setState] = useState<ViewState>({ kind: "laedt" });
  // Zaehler statt Bool: nach zwei Speichervorgaengen hintereinander muss die
  // Woche zweimal neu geladen werden, und ein Bool waere beim zweiten Mal
  // unveraendert.
  const [nachladen, setNachladen] = useState(0);
  /**
   * Idempotenzschluessel des laufenden Speichervorgangs.
   *
   * `useRef` und nicht `useState`: der Wert steuert keine Darstellung, und ein
   * Zustandswechsel mitten im Absenden wuerde eine unnoetige Neuberechnung
   * ausloesen. Er ueberlebt bewusst mehrere Absendeversuche derselben Eingabe.
   */
  const vorgangsSchluessel = useRef<{ vorgang: string; key: IdempotencyKey } | null>(null);
  /**
   * Die Woche, die GERADE auf dem Schirm steht. `speichern` schliesst ueber
   * `weekKey` — wechselt die Planerin waehrend des offenen Readbacks die
   * Woche, gehoert dessen Ergebnis zur alten und darf die neue nicht
   * ueberschreiben (EYT-158). Der Lade-Effekt hat dafuer sein `abgebrochen`;
   * der Speicherpfad braucht denselben Riegel.
   */
  const aktuelleWoche = useRef(weekKey);
  useEffect(() => {
    aktuelleWoche.current = weekKey;
  }, [weekKey]);

  /** Sichtbarkeit des Erstellungs-Inspectors. Reiner Darstellungszustand. */
  const [inspectorOffen, setInspectorOffen] = useState(false);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const inspectorId = useId();

  useEffect(() => {
    let abgebrochen = false;
    // Beim ersten Laden und beim Wochenwechsel ersetzt der Ladezustand den
    // bisherigen Inhalt. Ein Read-through derselben Woche nach erfolgreichem
    // Speichern laeuft dagegen im Hintergrund: sonst wird das Formular
    // ausgehaengt und seine gerade gesetzte Erfolgsmeldung verschwindet,
    // bevor die Planerin sie wahrnehmen kann.
    setState((aktuell) =>
      aktuell.kind === "geladen" && aktuell.window.weekKey === weekKey
        ? aktuell
        : { kind: "laedt" },
    );
    void gateway.getPlanningWindow({ weekKey }).then((result) => {
      if (abgebrochen) return;
      setState(
        result.ok
          ? { kind: "geladen", window: result.value }
          : { kind: "fehler", failure: result.failure },
      );
    });
    return () => {
      abgebrochen = true;
    };
  }, [gateway, weekKey, nachladen]);

  // Beim Oeffnen wandert der Fokus auf das erste Bedienelement des
  // Formulars — die Planerin hat die Oeffnung selbst ausgeloest, der Sprung
  // ist ihre Absicht. Beim Schliessen setzt `schliessen` ihn zurueck.
  useEffect(() => {
    if (!inspectorOffen) return;
    // Das erste FACHLICHE Bedienelement, nicht das erste fokussierbare — die
    // Schliessen-Schaltflaeche steht davor. Ohne Formular (keine aktiven
    // Stammdaten) faellt der Fokus auf den Inspector selbst, damit der
    // Erklaertext im Lesefluss liegt.
    const formularFeld = inspectorRef.current?.querySelector<HTMLElement>(
      '[data-testid="einsatzformular"] select, [data-testid="einsatzformular"] input',
    );
    (formularFeld ?? inspectorRef.current)?.focus();
  }, [inspectorOffen]);

  const schliessen = useCallback(() => {
    setInspectorOffen(false);
    // Fokus zurueck auf den Ausloeser — ueber den Anker statt ueber eine Ref,
    // weil die Primitives (`Button`, `PrimaryAction`) keine Refs durchreichen
    // und der Ausloeser je nach Stand das eine oder das andere ist.
    document.querySelector<HTMLElement>('[data-testid="werkbank-einsatz-anlegen"]')?.focus();
  }, []);

  /**
   * Speichern und den SERVERSTAND neu lesen.
   *
   * Bewusst kein optimistisches Einfuegen der lokal gebauten Zuweisung: die
   * angezeigte Liste soll das sein, was der Server hat, nicht das, was der
   * Browser erwartet. Sonst saehe ein fehlgeschlagenes Speichern, dessen
   * Antwort verloren ging, aus wie ein gelungenes.
   */
  const speichern = useCallback(
    async (
      befehl: WorksiteDayInput,
    ): Promise<{ ok: boolean; failure?: GatewayFailure; detail?: string }> => {
      // Ein Schluessel je VORGANG, nicht je Absendeklick.
      //
      // Hier stand `newIdempotencyKey()` direkt im Aufruf, und das war der
      // Fehler: bei einem Netzwerkabbruch weiss die Planerin nicht, ob der
      // Einsatz angekommen ist. Sie drueckt erneut — und mit einem frischen
      // Schluessel legt der Server einen ZWEITEN Einsatz an. Der Schutz, den
      // der Schluessel geben soll, wirkt genau dann nicht, wenn man ihn
      // braucht.
      //
      // Der Schluessel gehoert deshalb zur Eingabe, nicht zum Klick: solange
      // dieselben fuenf Felder abgeschickt werden, bleibt er gleich. Erst ein
      // ERFOLG verwirft ihn (siehe unten), denn danach ist der Vorgang
      // abgeschlossen und der naechste Einsatz ist ein neuer.
      const vorgang = JSON.stringify(befehl);
      let schluessel = vorgangsSchluessel.current;
      if (schluessel === null || schluessel.vorgang !== vorgang) {
        schluessel = { vorgang, key: newIdempotencyKey() };
        vorgangsSchluessel.current = schluessel;
      }

      const ergebnis = await gateway.planWorksiteDay(
        { weekKey, ...befehl },
        { idempotencyKey: schluessel.key },
      );
      if (!ergebnis.ok) {
        const detail = ergebnis.problem?.detail;
        return {
          ok: false,
          failure: ergebnis.failure,
          ...(detail === undefined ? {} : { detail }),
        };
      }
      const readback = await gateway.getPlanningWindow({ weekKey });
      if (!readback.ok)
        return {
          ok: false,
          failure: readback.failure,
          detail:
            "Schreiben bestätigt, aber der aktuelle Serverstand konnte nicht geladen werden. Bitte erneut versuchen.",
        };
      const written = ergebnis.value;
      const readDay = readback.value.worksiteDays?.find(
        (day) => day.worksiteDayId === written.worksiteDayId,
      );
      if (
        readDay === undefined ||
        readDay.configurationId !== written.configurationId ||
        readDay.worksiteId !== written.worksiteId ||
        readDay.localDate !== written.localDate ||
        readDay.lockVersion !== written.lockVersion ||
        readDay.team.length !== written.team.length ||
        written.team.some(
          (member) =>
            !readDay.team.some(
              (row) =>
                row.assignmentId === member.assignmentId &&
                row.employeeId === member.employeeId &&
                Date.parse(row.interval.startUtc) === Date.parse(member.interval.startUtc) &&
                Date.parse(row.interval.endUtc) === Date.parse(member.interval.endUtc),
            ),
        )
      ) {
        return {
          ok: false,
          failure: "STALE_VERSION",
          detail:
            "Schreiben bestätigt, aber der gelesene Planstand stimmt nicht überein. Bitte erneut laden oder versuchen.",
        };
      }
      // Erst nach Write UND identischem Readback verwerfen: der Vorgang ist abgeschlossen, der
      // naechste Einsatz braucht einen eigenen Schluessel. Bei einem Fehler
      // bleibt er ausdruecklich stehen, damit ein Wiederholungsversuch
      // derselben Eingabe derselbe Vorgang bleibt.
      vorgangsSchluessel.current = null;
      // Nur die Woche ersetzen, die noch angezeigt wird. Ist inzwischen eine
      // andere geladen, ist der Write trotzdem bestaetigt — die Karte steht in
      // ihrer eigenen Woche, nicht in dieser.
      if (aktuelleWoche.current === weekKey) {
        setState({ kind: "geladen", window: readback.value });
      }
      return { ok: true };
    },
    [gateway, weekKey],
  );

  if (state.kind === "laedt") {
    return (
      <Card>
        <LoadingState data-testid="planungsfenster-laedt" label="Wochenplan wird geladen …" />
      </Card>
    );
  }

  if (state.kind === "fehler") {
    // Ein Zustand, drei Lesarten — und deshalb drei Bausteine. Bis EYT-141
    // trug jeder Portfehler dieselbe graue Zeile: „keine Berechtigung" sah aus
    // wie „Server weg", obwohl das eine ein Rechtezustand ist, den kein
    // Wiederholen loest, und das andere ein Ausfall, den genau das loest.
    //
    // `data-testid` und `data-failure` bleiben auf ALLEN drei Zweigen
    // unveraendert: daran haengen Reisen (`werkbank-serverwahrheit.test.tsx`,
    // `read-through.spec.ts`), und ein Baustein-Wechsel darf keinen Anker
    // still entfernen. `data-zustand` kommt hinzu, es verschwindet keiner.
    const klasse = ZUSTANDSKLASSE[state.failure];
    const gemeinsam = {
      "data-testid": "planungsfenster-fehler",
      "data-failure": state.failure,
      "data-zustand": klasse,
    } as const;

    return (
      <Card>
        {klasse === "kein-zugriff" ? (
          <StateBanner {...gemeinsam} tone="info" title="Kein Zugriff">
            {FAILURE_TEXT[state.failure]}
          </StateBanner>
        ) : klasse === "veraltet" ? (
          <StateBanner {...gemeinsam} tone="warning" title="Stand veraltet">
            {FAILURE_TEXT[state.failure]}
          </StateBanner>
        ) : (
          <ErrorState
            {...gemeinsam}
            title="Wochenplan nicht ladbar"
            description={FAILURE_TEXT[state.failure]}
            onRetry={() => setNachladen((n) => n + 1)}
            retryLabel="Erneut laden"
          />
        )}
      </Card>
    );
  }

  const { window: fenster } = state;
  const stand = standKennung(fenster);
  const raster = wochenraster(fenster);

  // Genau eine primaere Aktion: veroeffentlichbarer Entwurf mit Recht macht
  // „Plan veroeffentlichen" primaer (in `PlanningPublishAction`), sonst ist
  // es „Einsatz anlegen". Beide Bedingungen speisen sich aus DEMSELBEN
  // Serverstand — sie koennen nicht gleichzeitig wahr sein.
  const publishIstPrimaer = fenster.sourceVersion?.state === "draft" && darfVeroeffentlichen;

  const ausloeserProps = {
    "data-testid": "werkbank-einsatz-anlegen",
    "aria-expanded": inspectorOffen,
    "aria-controls": inspectorId,
    onClick: () => {
      if (inspectorOffen) {
        schliessen();
      } else {
        setInspectorOffen(true);
      }
    },
  } as const;

  return (
    <Card
      className="werkbank-fenster"
      data-stand={stand}
      data-inspector={inspectorOffen ? "offen" : "zu"}
    >
      <div className="werkbank-fenster__status">
        <div className="werkbank-fenster__titel">
          <h2 data-testid="planungsfenster-woche">
            Wochenplan <VisuallyHidden>{fenster.weekKey}</VisuallyHidden>
          </h2>
          <p className="werkbank-fenster__zone" data-testid="planungsfenster-zone">
            Zeitzone: {fenster.timeZone}
          </p>
        </div>
        <div className="werkbank-fenster__stand">
          <p data-testid="planungsfenster-stand" data-stand={stand}>
            <StatusBadge data-testid="planungsfenster-stand-abzeichen" tone={STAND_TON[stand]}>
              {STAND_ABZEICHEN[stand]}
            </StatusBadge>
            {STAND_TEXT[stand] === null ? null : <> {STAND_TEXT[stand]}</>}
          </p>
          {/*
            Die serverseitigen Versions-Ids sind Serverwahrheit, kein
            Planertext (PO-Review-Reparatur EYT-147): sie stehen NUR in den
            `data-*`-Attributen, an denen `read-through.spec.ts`,
            `auth-journey` und die Werkbank-Suiten haengen. Sichtbar bleibt
            allein die eine Aussage, die das Abzeichen nicht traegt: dass
            fuer diese Woche noch nichts veroeffentlicht ist.
          */}
          <p
            className="werkbank-fenster__version"
            data-testid="planungsfenster-version"
            data-source-version-id={fenster.sourceVersion?.id ?? ""}
            data-source-state={fenster.sourceVersion?.state ?? ""}
            data-published-version-id={fenster.publishedVersionId ?? ""}
          >
            {fenster.publishedVersionId === null ? "Noch nichts veröffentlicht" : null}
          </p>
        </div>
      </div>

      <div className="werkbank-fenster__aktionen">
        {/*
          Die Publish-Aktion (EYT-107). Sie bekommt den SERVERstand herein und
          meldet die Serverantwort zurueck; die Woche wird danach neu gelesen.
          Sie setzt selbst nichts — siehe Dateikopf von
          `planning-publish-action.tsx`.
        */}
        <PlanningPublishAction
          weekKey={fenster.weekKey}
          sourceVersion={fenster.sourceVersion}
          darfVeroeffentlichen={darfVeroeffentlichen}
          publishPlan={(befehl, optionen) => gateway.publishPlan(befehl, optionen)}
          onVeroeffentlicht={() => setNachladen((n) => n + 1)}
        />
        {publishIstPrimaer ? (
          <Button type="button" variant="ghost" {...ausloeserProps}>
            Baustellentag anlegen
          </Button>
        ) : (
          <PrimaryAction {...ausloeserProps}>Baustellentag anlegen</PrimaryAction>
        )}
      </div>

      {fenster.assignments.length === 0 && (fenster.worksiteDays?.length ?? 0) === 0 ? (
        <EmptyState
          data-testid="planungsfenster-leer"
          title="Für diese Woche ist nichts geplant."
          description="Lege über „Baustellentag anlegen“ den ersten Tag an — Baustelle, Datum, Arbeitszeit und Einsatzteam."
        />
      ) : null}

      <div className="werkbank-fenster__flaeche">
        {raster.art === "raster" ? (
          <div data-testid="planungsfenster-liste" className="wochenraster">
            {raster.tage.map((tag) => (
              <div key={tag.tagKey} className="wochenraster__tag" data-tag={tag.tagKey}>
                <h3 className="wochenraster__tagkopf">
                  {tag.wochentagsText}{" "}
                  <span className="wochenraster__tagdatum">{tag.datumsText}</span>
                </h3>
                {tag.einsaetze.length === 0 &&
                !fenster.worksiteDays?.some((day) => day.localDate === tag.tagKey) ? (
                  // Nur Zierde fuer Sehende: die Abwesenheit einer Liste sagt
                  // dem Screenreader dasselbe, ein zweiter Text waere Rauschen.
                  <p className="wochenraster__frei" aria-hidden="true">
                    –
                  </p>
                ) : (
                  <Tagesplanung
                    days={fenster.worksiteDays?.filter((day) => day.localDate === tag.tagKey) ?? []}
                    assignments={tag.einsaetze}
                    fenster={fenster}
                  />
                )}
              </div>
            ))}
            {raster.ausserhalb.length > 0 ||
            fenster.worksiteDays?.some(
              (day) => !raster.tage.some((tag) => tag.tagKey === day.localDate),
            ) ? (
              // Antworten, die der Server so eigentlich nicht liefern kann —
              // aber „kann nicht sein" ist kein Renderpfad: sichtbar statt
              // verschluckt (`lib/wochenraster.ts`).
              <div className="wochenraster__ausserhalb">
                <h3>Außerhalb dieser Woche</h3>
                <Tagesplanung
                  days={
                    fenster.worksiteDays?.filter(
                      (day) => !raster.tage.some((tag) => tag.tagKey === day.localDate),
                    ) ?? []
                  }
                  assignments={raster.ausserhalb}
                  fenster={fenster}
                />
              </div>
            ) : null}
          </div>
        ) : (
          // Zone oder Woche unbestimmbar: die flache Liste ist die ehrliche
          // Rueckfallebene — alle Daten sichtbar, nichts geraten.
          <>
            <StateBanner tone="warning" title="Tageszuordnung nicht möglich">
              {raster.grund === "zone-unbekannt"
                ? `Die Zeitzone „${fenster.timeZone}“ ist dieser Laufzeit unbekannt; die Einsätze stehen ungeordnet untereinander.`
                : `Der Wochenschlüssel „${fenster.weekKey}“ ist nicht lesbar; die Einsätze stehen ungeordnet untereinander.`}
            </StateBanner>
            {fenster.assignments.length > 0 || (fenster.worksiteDays?.length ?? 0) > 0 ? (
              <div data-testid="planungsfenster-liste">
                <Tagesplanung
                  days={fenster.worksiteDays ?? []}
                  assignments={fenster.assignments}
                  fenster={fenster}
                  ueberschrift="h3"
                />
              </div>
            ) : null}
          </>
        )}

        {inspectorOffen ? (
          <div
            id={inspectorId}
            ref={inspectorRef}
            tabIndex={-1}
            className="werkbank-inspector"
            data-testid="werkbank-inspector"
            onKeyDown={(ereignis) => {
              // Nichtmodal, aber mit Rueckweg: Escape schliesst und stellt
              // den Fokus auf den Ausloeser zurueck. Kein Fokus-Trap — Tab
              // verlaesst den Inspector wie jeden anderen Seitenbereich.
              if (ereignis.key === "Escape") {
                ereignis.stopPropagation();
                schliessen();
              }
            }}
          >
            <div className="werkbank-inspector__kopf">
              <Button
                type="button"
                variant="ghost"
                data-testid="werkbank-inspector-schliessen"
                onClick={schliessen}
              >
                Schließen
              </Button>
            </div>
            <WorksiteDayForm window={fenster} onSubmit={speichern} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
