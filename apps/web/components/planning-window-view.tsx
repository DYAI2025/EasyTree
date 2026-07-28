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
  type PlanningResource,
  type PlanningWindow,
} from "@easytree/contracts";
import { Card } from "@easytree/ui";
import { useCallback, useEffect, useState } from "react";

import { usePlanningGateway } from "../lib/planning-gateway-provider";
import { AssignmentForm } from "./assignment-form";

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

export function PlanningWindowView({ weekKey }: { weekKey: string }) {
  const gateway = usePlanningGateway();
  const [state, setState] = useState<ViewState>({ kind: "laedt" });
  // Zaehler statt Bool: nach zwei Speichervorgaengen hintereinander muss die
  // Woche zweimal neu geladen werden, und ein Bool waere beim zweiten Mal
  // unveraendert.
  const [nachladen, setNachladen] = useState(0);

  useEffect(() => {
    let abgebrochen = false;
    setState({ kind: "laedt" });
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
      // Frischer Schluessel je Absendevorgang. Ein wiederverwendeter waere der
      // Wiederholungsschutz eines FRUEHEREN Einsatzes — der zweite Entwurf
      // wuerde stillschweigend als Duplikat des ersten beantwortet.
      const ergebnis = await gateway.createAssignment(
        { weekKey, ...befehl },
        { idempotencyKey: newIdempotencyKey() },
      );
      if (!ergebnis.ok) {
        const detail = ergebnis.problem?.detail;
        return {
          ok: false,
          failure: ergebnis.failure,
          ...(detail === undefined ? {} : { detail }),
        };
      }
      setNachladen((n) => n + 1);
      return { ok: true };
    },
    [gateway, weekKey],
  );

  if (state.kind === "laedt") {
    return (
      <Card>
        <p data-testid="planungsfenster-laedt">Wochenplan wird geladen …</p>
      </Card>
    );
  }

  if (state.kind === "fehler") {
    return (
      <Card>
        <p data-testid="planungsfenster-fehler" data-failure={state.failure} role="alert">
          {FAILURE_TEXT[state.failure]}
        </p>
      </Card>
    );
  }

  const { window: fenster } = state;

  return (
    <Card>
      <h2 data-testid="planungsfenster-woche">Wochenplan {fenster.weekKey}</h2>
      <p data-testid="planungsfenster-zone">Zeitzone: {fenster.timeZone}</p>
      <p data-testid="planungsfenster-stand" data-stand={standKennung(fenster)}>
        {STAND_TEXT[standKennung(fenster)]}
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

      {fenster.assignments.length === 0 ? (
        <p data-testid="planungsfenster-leer">Für diese Woche ist nichts geplant.</p>
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
