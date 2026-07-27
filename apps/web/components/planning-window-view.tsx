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
import type { GatewayFailure, PlanningWindow } from "@easytree/contracts";
import { Card } from "@easytree/ui";
import { useEffect, useState } from "react";

import { usePlanningGateway } from "../lib/planning-gateway-provider";

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

export function PlanningWindowView({ weekKey }: { weekKey: string }) {
  const gateway = usePlanningGateway();
  const [state, setState] = useState<ViewState>({ kind: "laedt" });

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
  }, [gateway, weekKey]);

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
      <p
        data-testid="planungsfenster-version"
        data-published-version-id={fenster.publishedVersionId ?? ""}
      >
        {fenster.publishedVersionId === null
          ? "Noch nicht veroeffentlicht"
          : `Veroeffentlichte Version: ${fenster.publishedVersionId}`}
      </p>

      {fenster.assignments.length === 0 ? (
        <p data-testid="planungsfenster-leer">Für diese Woche ist nichts geplant.</p>
      ) : (
        <ul data-testid="planungsfenster-liste">
          {fenster.assignments.map((assignment) => (
            <li key={assignment.id} data-assignment-id={assignment.id}>
              {assignment.interval.startUtc} – {assignment.interval.endUtc}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
