"use client";

/**
 * Read-only Planungsfenster (EYT-50).
 *
 * Bewusst schmal: die kleinste Ansicht, die den SERVERSTAND zeigt. Kein
 * Planner, keine Bearbeitung, keine Wochennavigation — das ist EYT-72.
 *
 * ## Vier Zustaende, alle sichtbar
 *
 * laden, leer, Fehler, Erfolg. Der Fehlerzustand ist der wichtigste: er zeigt
 * den Grund aus dem Port (`GatewayFailure`) an, statt eine leere Woche zu
 * rendern. Eine leere Woche und eine fehlgeschlagene Abfrage sehen sonst
 * identisch aus, und der Ausfall wuerde als "nichts geplant" gelesen.
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
 * und Text ist Darstellung.
 */
import {
  newIdempotencyKey,
  type GatewayFailure,
  type IdempotencyKey,
  type PlanningResource,
  type PlanningWindow,
} from "@easytree/contracts";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StateBanner,
  StatusBadge,
  type StatusTone,
} from "@easytree/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { usePlanningGateway } from "../lib/planning-gateway-provider";
import { AssignmentForm } from "./planning-assignment-form";
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
  FORBIDDEN: "Keine Berechtigung fuer diese Organisation.",
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

const STAND_TEXT: Record<Stand, string> = {
  "ohne-version": "Für diese Woche existiert noch keine Planversion.",
  entwurf: "Unveroeffentlichter Entwurf.",
  veroeffentlicht: "Veroeffentlichter Stand.",
  "entwurf-ueber-veroeffentlicht":
    "Entwurf auf Basis einer bereits veroeffentlichten Version — die Anzeige zeigt den ENTWURF.",
};

/**
 * Kurzform des Standes als Abzeichen (EYT-140 M7, `AC-008`/`AC-018`).
 *
 * Der Satz in `STAND_TEXT` bleibt die Aussage; das Abzeichen traegt sie ein
 * zweites Mal ueber Form und Zeichen. `StatusBadge` setzt je Ton eine eigene
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
  veroeffentlicht: "Veroeffentlicht",
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

  /**
   * Speichern und den SERVERSTAND neu lesen.
   *
   * Bewusst kein optimistisches Einfuegen der lokal gebauten Zuweisung: die
   * angezeigte Liste soll das sein, was der Server hat, nicht das, was der
   * Browser erwartet. Sonst saehe ein fehlgeschlagenes Speichern, dessen
   * Antwort verloren ging, aus wie ein gelungenes.
   */
  const speichern = useCallback(
    async (befehl: {
      employeeId: string;
      worksiteId: string;
      interval: { startUtc: string; endUtc: string };
    }): Promise<{ ok: boolean; failure?: GatewayFailure; detail?: string }> => {
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

      const ergebnis = await gateway.createAssignment(
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
      // Erst nach Erfolg verwerfen: der Vorgang ist abgeschlossen, der
      // naechste Einsatz braucht einen eigenen Schluessel. Bei einem Fehler
      // bleibt er ausdruecklich stehen, damit ein Wiederholungsversuch
      // derselben Eingabe derselbe Vorgang bleibt.
      vorgangsSchluessel.current = null;
      setNachladen((n) => n + 1);
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

  return (
    <Card>
      <h2 data-testid="planungsfenster-woche">Wochenplan {fenster.weekKey}</h2>
      <p data-testid="planungsfenster-zone">Zeitzone: {fenster.timeZone}</p>
      <p data-testid="planungsfenster-stand" data-stand={stand}>
        <StatusBadge data-testid="planungsfenster-stand-abzeichen" tone={STAND_TON[stand]}>
          {STAND_ABZEICHEN[stand]}
        </StatusBadge>{" "}
        {STAND_TEXT[stand]}
      </p>
      <p
        data-testid="planungsfenster-version"
        data-source-version-id={fenster.sourceVersion?.id ?? ""}
        data-source-state={fenster.sourceVersion?.state ?? ""}
        data-published-version-id={fenster.publishedVersionId ?? ""}
      >
        {fenster.publishedVersionId === null
          ? "Noch nichts veroeffentlicht"
          : `Zuletzt veroeffentlicht: ${fenster.publishedVersionId}`}
      </p>

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

      {fenster.assignments.length === 0 ? (
        <EmptyState
          data-testid="planungsfenster-leer"
          title="Für diese Woche ist nichts geplant."
          description="Lege unten den ersten Einsatz an — Person, Baustelle und Zeitraum genügen."
        />
      ) : (
        <ul data-testid="planungsfenster-liste">
          {fenster.assignments.map((assignment) => (
            <li
              key={assignment.id}
              data-assignment-id={assignment.id}
              data-employee-id={assignment.employeeId}
              data-worksite-id={assignment.worksiteId}
            >
              {/* Namen statt Uuids: eine Planerin erkennt "Anna Berg auf
                  Baustelle Nord", nicht 22222222-…. Die Ids bleiben als
                  data-Attribute im Markup, weil AK9 den Id-Vergleich zwischen
                  Planer- und Mitarbeitersicht verlangt — der braucht die Id
                  selbst, nicht ihre Darstellung. */}
              <strong>{anzeigename(fenster.resources.employees, assignment.employeeId)}</strong>
              {" auf "}
              {anzeigename(fenster.resources.worksites, assignment.worksiteId)}
              {": "}
              {assignment.interval.startUtc} – {assignment.interval.endUtc}
            </li>
          ))}
        </ul>
      )}

      <AssignmentForm window={fenster} onSubmit={speichern} />
    </Card>
  );
}
