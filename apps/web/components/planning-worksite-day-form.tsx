"use client";

import type { GatewayFailure, PlanningWindow, PlanWorksiteDayCommand } from "@easytree/contracts";
import { Button } from "@easytree/ui";
import { useId, useState } from "react";
import { UMRECHNUNG_TEXT, zuIntervall } from "./planning-assignment-form";

export type WorksiteDayInput = Omit<PlanWorksiteDayCommand, "weekKey">;
const INITIAL = {
  worksiteId: "",
  datum: "",
  beginn: "08:00",
  ende: "18:00",
  employeeIds: [] as string[],
};
const ERRORS: Record<GatewayFailure, string> = {
  UNAUTHENTICATED: "Nicht angemeldet. Bitte erneut anmelden.",
  FORBIDDEN: "Keine Berechtigung für diese Organisation.",
  REJECTED: "Der Baustellentag wurde abgelehnt. Bitte die Eingabe prüfen.",
  STALE_VERSION: "Der Planstand hat sich geändert. Bitte die Woche neu laden.",
  UNAVAILABLE: "Der Server ist nicht erreichbar. Das Speichern ist nicht bestätigt.",
  CONTRACT_VIOLATION: "Die Serverantwort ist ungültig. Das Speichern ist nicht bestätigt.",
};

/** Nur Eingabezustand. Erfolg und sichtbare Planung stammen aus dem Readback. */
export function WorksiteDayForm({
  window: fenster,
  onSubmit,
}: {
  readonly window: PlanningWindow;
  readonly onSubmit: (
    input: WorksiteDayInput,
  ) => Promise<{ ok: boolean; failure?: GatewayFailure; detail?: string }>;
}) {
  const [input, setInput] = useState(INITIAL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const prefix = useId();
  const id = (name: string) => `${prefix}-${name}`;
  const employees = fenster.resources.employees.filter((e) => e.active);
  const worksites = fenster.resources.worksites.filter((w) => w.active);
  const complete =
    input.worksiteId !== "" &&
    input.datum !== "" &&
    input.beginn !== "" &&
    input.ende !== "" &&
    input.employeeIds.length > 0;
  const change = (field: "worksiteId" | "datum" | "beginn" | "ende", value: string) => {
    setMessage(null);
    setInput((old) => ({ ...old, [field]: value }));
  };
  if (employees.length === 0 || worksites.length === 0) {
    return (
      <section data-testid="einsatzformular-leer" aria-labelledby={id("title")}>
        <h3 id={id("title")}>Baustellentag planen</h3>
        <p role="status">
          {employees.length === 0 && worksites.length === 0
            ? "Für diese Organisation sind weder aktive Mitarbeitende noch aktive Baustellen hinterlegt."
            : employees.length === 0
              ? "Für diese Organisation sind keine aktiven Mitarbeitenden hinterlegt."
              : "Für diese Organisation sind keine aktiven Baustellen hinterlegt."}
        </p>
      </section>
    );
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || busy) return;
    const result = zuIntervall(input, fenster.timeZone);
    if (!result.ok) {
      setMessage({ ok: false, text: UMRECHNUNG_TEXT[result.fehler] });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await onSubmit({
        worksiteId: input.worksiteId,
        localDate: input.datum,
        team: [...input.employeeIds].sort().map((employeeId) => ({
          employeeId,
          interval: { startUtc: result.startUtc, endUtc: result.endUtc },
        })),
      });
      if (response.ok) {
        setInput(INITIAL);
        setMessage({
          ok: true,
          text: "Der Baustellentag wurde gespeichert und aus dem Serverstand geladen.",
        });
      } else {
        setMessage({
          ok: false,
          text: response.detail ?? ERRORS[response.failure ?? "UNAVAILABLE"],
        });
      }
    } catch {
      setMessage({ ok: false, text: ERRORS.UNAVAILABLE });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="einsatzformular-bereich" aria-labelledby={id("title")}>
      <h3 id={id("title")}>Baustellentag planen</h3>
      <form
        data-testid="einsatzformular"
        className="einsatzformular"
        onSubmit={submit}
        aria-describedby={message === null ? undefined : id("message")}
      >
        <div className="einsatzformular__feld">
          <label htmlFor={id("worksite")}>Baustelle</label>
          <select
            id={id("worksite")}
            data-testid="feld-worksite"
            value={input.worksiteId}
            disabled={busy}
            onChange={(e) => change("worksiteId", e.target.value)}
          >
            <option value="">Bitte wählen …</option>
            {worksites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
        <div className="einsatzformular__feld">
          <label htmlFor={id("datum")}>Datum</label>
          <input
            id={id("datum")}
            data-testid="feld-datum"
            type="date"
            value={input.datum}
            disabled={busy}
            onChange={(e) => change("datum", e.target.value)}
          />
        </div>
        <div className="einsatzformular__zeiten">
          <div className="einsatzformular__feld">
            <label htmlFor={id("beginn")}>Beginn ({fenster.timeZone})</label>
            <input
              id={id("beginn")}
              data-testid="feld-beginn"
              type="time"
              value={input.beginn}
              disabled={busy}
              onChange={(e) => change("beginn", e.target.value)}
            />
          </div>
          <div className="einsatzformular__feld">
            <label htmlFor={id("ende")}>Ende ({fenster.timeZone})</label>
            <input
              id={id("ende")}
              data-testid="feld-ende"
              type="time"
              value={input.ende}
              disabled={busy}
              onChange={(e) => change("ende", e.target.value)}
            />
          </div>
        </div>
        <div className="einsatzformular__feld">
          <label htmlFor={id("employee")}>Einsatzteam – Mitarbeitende</label>
          <select
            id={id("employee")}
            data-testid="feld-employee"
            multiple
            size={5}
            value={input.employeeIds}
            disabled={busy}
            aria-describedby={id("team-help")}
            onChange={(e) => {
              setMessage(null);
              setInput((old) => ({
                ...old,
                employeeIds: [...e.target.selectedOptions].map((o) => o.value),
              }));
            }}
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <p id={id("team-help")}>
            Mehrfachauswahl — Maus: Umschalttaste für einen Bereich, Strg beziehungsweise ⌘ für
            einzelne Personen. Tastatur: Pfeiltasten wechseln die Auswahl, Umschalt+Pfeil erweitert
            sie, ⌘ beziehungsweise Strg+Pfeil bewegt ohne Auswahl, Leertaste wählt eine Person an
            oder ab. {input.employeeIds.length} ausgewählt.
          </p>
        </div>
        <Button type="submit" data-testid="einsatz-speichern" disabled={!complete || busy}>
          {busy ? "Wird gespeichert …" : "Baustellentag speichern"}
        </Button>
      </form>
      {message === null ? null : (
        <p
          id={id("message")}
          className="einsatzformular__meldung"
          data-testid="einsatzformular-meldung"
          data-state={message.ok ? "erfolg" : "fehler"}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
