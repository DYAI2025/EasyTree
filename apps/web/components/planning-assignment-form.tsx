"use client";

/**
 * Einsatzformular (EYT-92).
 *
 * Der zweite Schritt der Nutzerreise: Mitarbeiter, Baustelle, Datum, Start und
 * Ende auswaehlen. Alles, was hier zur Auswahl steht, stammt aus derselben
 * Serverantwort wie die Woche selbst — es gibt keine zweite Datenquelle, keinen
 * LocalStorage und keine eingebaute Demoliste.
 *
 * ## Warum die Absendesperre keine Kosmetik ist
 *
 * `istVollstaendig` entscheidet, ob ueberhaupt ein Schreibaufruf entstehen
 * kann. Ein Formular, das unvollstaendig absendet und den Server ablehnen
 * laesst, erzeugt Last, Lograuschen und eine Fehlermeldung fuer etwas, das die
 * Oberflaeche selbst wusste. Die Sperre ersetzt die serverseitige Pruefung
 * NICHT — sie kommt ihr nur zuvor.
 *
 * ## Warum inaktive Eintraege nicht auswaehlbar sind
 *
 * `resources` liefert bewusst alle tenant-sichtbaren Eintraege, damit ein
 * bestehender Einsatz auf eine ausgeschiedene Person ihren Namen behaelt. Fuer
 * NEUE Einsaetze sind sie hier gefiltert. Der Unterschied ist fachlich: die
 * Vergangenheit bleibt lesbar, die Zukunft nicht mehr planbar.
 *
 * ## Zeitzone
 *
 * Die Umrechnung Wanduhr -> UTC laeuft ueber `utcInstantOfLocalWallTime` mit
 * der Zone der ORGANISATION aus der Serverantwort, nie mit der des Browsers.
 * Eine Planerin im Urlaub darf keine um Stunden verschobenen Schichten anlegen.
 * Die zwei Tage im Jahr, an denen eine Wanduhrzeit nicht oder doppelt
 * existiert, werden angezeigt statt geraten.
 */
import type { GatewayFailure, PlanningResource, PlanningWindow } from "@easytree/contracts";
import { createTimeZone, utcInstantOfLocalWallTime } from "@easytree/domain";
import { Button } from "@easytree/ui";
import { useId, useState } from "react";

export interface EntwurfEingabe {
  readonly employeeId: string;
  readonly worksiteId: string;
  /** Kalendertag in der Zone der Organisation, `YYYY-MM-DD` aus `<input type="date">`. */
  readonly datum: string;
  /** `HH:MM` aus `<input type="time">`. */
  readonly beginn: string;
  readonly ende: string;
}

const LEER: EntwurfEingabe = {
  employeeId: "",
  worksiteId: "",
  datum: "",
  beginn: "",
  ende: "",
};

/** Alle fuenf Felder gesetzt. Weniger ist kein Entwurf, sondern eine Absicht. */
function istVollstaendig(e: EntwurfEingabe): boolean {
  return (
    e.employeeId !== "" && e.worksiteId !== "" && e.datum !== "" && e.beginn !== "" && e.ende !== ""
  );
}

/** `YYYY-MM-DD` -> Kalendertag. `null`, wenn die Form nicht stimmt. */
function kalendertag(datum: string): { year: number; month: number; day: number } | null {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  if (treffer === null) return null;
  const [, j, m, t] = treffer;
  if (j === undefined || m === undefined || t === undefined) return null;
  return {
    year: Number.parseInt(j, 10),
    month: Number.parseInt(m, 10),
    day: Number.parseInt(t, 10),
  };
}

/** `HH:MM` -> Stunde und Minute. `null`, wenn die Form nicht stimmt. */
function uhrzeit(wert: string): { hour: number; minute: number } | null {
  const treffer = /^(\d{2}):(\d{2})$/.exec(wert);
  if (treffer === null) return null;
  const [, h, min] = treffer;
  if (h === undefined || min === undefined) return null;
  return { hour: Number.parseInt(h, 10), minute: Number.parseInt(min, 10) };
}

export type UmrechnungsFehler =
  | "DATUM_UNGUELTIG"
  | "ZEIT_UNGUELTIG"
  | "ZONE_UNBEKANNT"
  | "ZEITPUNKT_EXISTIERT_NICHT"
  | "ZEITPUNKT_MEHRDEUTIG"
  | "ENDE_NICHT_NACH_BEGINN";

export const UMRECHNUNG_TEXT: Record<UmrechnungsFehler, string> = {
  DATUM_UNGUELTIG: "Bitte ein Datum im Format JJJJ-MM-TT angeben.",
  ZEIT_UNGUELTIG: "Bitte Beginn und Ende im Format HH:MM angeben.",
  ZONE_UNBEKANNT: "Die Zeitzone der Organisation ist dieser Laufzeit unbekannt.",
  ZEITPUNKT_EXISTIERT_NICHT:
    "Diesen Zeitpunkt gibt es nicht: In dieser Nacht beginnt die Sommerzeit und die Uhr überspringt die Stunde. Bitte eine andere Uhrzeit wählen.",
  ZEITPUNKT_MEHRDEUTIG:
    "Dieser Zeitpunkt kommt in dieser Nacht zweimal vor, weil die Sommerzeit endet. Bitte eine Uhrzeit außerhalb der Umstellungsstunde wählen.",
  ENDE_NICHT_NACH_BEGINN: "Das Ende muss nach dem Beginn liegen.",
};

export type IntervallErgebnis =
  | { readonly ok: true; readonly startUtc: string; readonly endUtc: string }
  | { readonly ok: false; readonly fehler: UmrechnungsFehler };

/**
 * Eingabe -> UTC-Intervall des Vertrags.
 *
 * Exportiert, weil dies die einzige Stelle ist, an der Wanduhrzeit zu einem
 * Instant wird — sie gehoert einzeln pruefbar, nicht nur ueber die Oberflaeche.
 */
export function zuIntervall(eingabe: EntwurfEingabe, zone: string): IntervallErgebnis {
  const tag = kalendertag(eingabe.datum);
  if (tag === null) return { ok: false, fehler: "DATUM_UNGUELTIG" };
  const von = uhrzeit(eingabe.beginn);
  const bis = uhrzeit(eingabe.ende);
  if (von === null || bis === null) return { ok: false, fehler: "ZEIT_UNGUELTIG" };

  const zonenErgebnis = createTimeZone(zone);
  if (!zonenErgebnis.ok) return { ok: false, fehler: "ZONE_UNBEKANNT" };

  const start = utcInstantOfLocalWallTime({ date: tag, ...von }, zonenErgebnis.timeZone);
  const ende = utcInstantOfLocalWallTime({ date: tag, ...bis }, zonenErgebnis.timeZone);
  for (const r of [start, ende]) {
    if (!r.ok) {
      return {
        ok: false,
        fehler:
          r.error === "NONEXISTENT_LOCAL_TIME"
            ? "ZEITPUNKT_EXISTIERT_NICHT"
            : "ZEITPUNKT_MEHRDEUTIG",
      };
    }
  }
  if (!start.ok || !ende.ok) return { ok: false, fehler: "ZEIT_UNGUELTIG" };

  // Das Ende MUSS spaeter liegen. Ein Nullintervall waere kein Einsatz, und
  // ein negatives waere ein Tippfehler, den der Server ohnehin ablehnt.
  if (ende.instant.getTime() <= start.instant.getTime()) {
    return { ok: false, fehler: "ENDE_NICHT_NACH_BEGINN" };
  }

  return {
    ok: true,
    startUtc: start.instant.toISOString(),
    endUtc: ende.instant.toISOString(),
  };
}

const FEHLER_TEXT: Record<GatewayFailure, string> = {
  UNAVAILABLE: "Der Server ist nicht erreichbar. Der Entwurf wurde NICHT gespeichert.",
  CONTRACT_VIOLATION: "Die Antwort des Servers entspricht nicht dem Vertrag.",
  UNAUTHENTICATED: "Nicht angemeldet.",
  FORBIDDEN: "Keine Berechtigung für diese Organisation.",
  STALE_VERSION: "Der Planstand hat sich zwischenzeitlich geändert. Bitte die Woche neu laden.",
  REJECTED: "Der Entwurf wurde abgelehnt.",
};

function auswahl(eintraege: readonly PlanningResource[]): readonly PlanningResource[] {
  return eintraege.filter((eintrag) => eintrag.active);
}

export interface AssignmentFormProps {
  readonly window: PlanningWindow;
  /** Wird nur mit vollstaendiger, umgerechneter Eingabe aufgerufen. */
  readonly onSubmit: (befehl: {
    employeeId: string;
    worksiteId: string;
    interval: { startUtc: string; endUtc: string };
  }) => Promise<{ ok: boolean; failure?: GatewayFailure; detail?: string }>;
}

type FormularMeldung =
  | { readonly art: "erfolg"; readonly text: string }
  | { readonly art: "fehler"; readonly text: string };

export function AssignmentForm({ window: fenster, onSubmit }: AssignmentFormProps) {
  const [eingabe, setEingabe] = useState<EntwurfEingabe>(LEER);
  const [meldung, setMeldung] = useState<FormularMeldung | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const idPrefix = useId();

  const beschaeftigte = auswahl(fenster.resources.employees);
  const baustellen = auswahl(fenster.resources.worksites);
  const keineAuswahl = beschaeftigte.length === 0 || baustellen.length === 0;
  const vollstaendig = istVollstaendig(eingabe);

  if (keineAuswahl) {
    // Leerzustand mit Grund. Ein deaktiviertes Formular ohne Erklaerung liesse
    // die Planerin raten, ob die Seite kaputt ist oder Stammdaten fehlen.
    return (
      <section aria-labelledby={`${idPrefix}-leer`} data-testid="einsatzformular-leer">
        <h3 id={`${idPrefix}-leer`}>Einsatz planen</h3>
        <p role="status">
          {beschaeftigte.length === 0 && baustellen.length === 0
            ? "Für diese Organisation sind weder aktive Mitarbeitende noch aktive Baustellen hinterlegt. Ohne beides lässt sich kein Einsatz planen."
            : beschaeftigte.length === 0
              ? "Für diese Organisation sind keine aktiven Mitarbeitenden hinterlegt. Ohne sie lässt sich kein Einsatz planen."
              : "Für diese Organisation sind keine aktiven Baustellen hinterlegt. Ohne sie lässt sich kein Einsatz planen."}
        </p>
      </section>
    );
  }

  const aendern = (feld: keyof EntwurfEingabe) => (wert: string) => {
    setMeldung(null);
    setEingabe((alt) => ({ ...alt, [feld]: wert }));
  };

  async function absenden(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Zweite Sperre neben `disabled`. Ein Absenden per Tastatur oder ein
    // Browser, der das Attribut ignoriert, darf keinen Schreibaufruf ausloesen.
    if (!vollstaendig || laeuft) return;

    const intervall = zuIntervall(eingabe, fenster.timeZone);
    if (!intervall.ok) {
      setMeldung({ art: "fehler", text: UMRECHNUNG_TEXT[intervall.fehler] });
      return;
    }

    setLaeuft(true);
    try {
      const ergebnis = await onSubmit({
        employeeId: eingabe.employeeId,
        worksiteId: eingabe.worksiteId,
        interval: { startUtc: intervall.startUtc, endUtc: intervall.endUtc },
      });
      if (ergebnis.ok) {
        setEingabe(LEER);
        setMeldung({ art: "erfolg", text: "Der Entwurf wurde gespeichert." });
        return;
      }
      setMeldung({
        art: "fehler",
        text:
          ergebnis.detail ??
          (ergebnis.failure === undefined
            ? "Der Entwurf wurde nicht gespeichert."
            : FEHLER_TEXT[ergebnis.failure]),
      });
    } finally {
      setLaeuft(false);
    }
  }

  const feld = (name: string): string => `${idPrefix}-${name}`;

  return (
    <section aria-labelledby={feld("titel")}>
      <h3 id={feld("titel")}>Einsatz planen</h3>
      <form
        data-testid="einsatzformular"
        onSubmit={absenden}
        aria-describedby={meldung === null ? undefined : feld("meldung")}
      >
        <label htmlFor={feld("employee")}>Mitarbeitende</label>
        <select
          id={feld("employee")}
          data-testid="feld-employee"
          value={eingabe.employeeId}
          onChange={(e) => aendern("employeeId")(e.target.value)}
        >
          <option value="">Bitte wählen …</option>
          {beschaeftigte.map((person) => (
            <option key={person.id} value={person.id}>
              {person.label}
            </option>
          ))}
        </select>

        <label htmlFor={feld("worksite")}>Baustelle</label>
        <select
          id={feld("worksite")}
          data-testid="feld-worksite"
          value={eingabe.worksiteId}
          onChange={(e) => aendern("worksiteId")(e.target.value)}
        >
          <option value="">Bitte wählen …</option>
          {baustellen.map((ort) => (
            <option key={ort.id} value={ort.id}>
              {ort.label}
            </option>
          ))}
        </select>

        <label htmlFor={feld("datum")}>Datum</label>
        <input
          id={feld("datum")}
          data-testid="feld-datum"
          type="date"
          value={eingabe.datum}
          onChange={(e) => aendern("datum")(e.target.value)}
        />

        <label htmlFor={feld("beginn")}>Beginn ({fenster.timeZone})</label>
        <input
          id={feld("beginn")}
          data-testid="feld-beginn"
          type="time"
          value={eingabe.beginn}
          onChange={(e) => aendern("beginn")(e.target.value)}
        />

        <label htmlFor={feld("ende")}>Ende ({fenster.timeZone})</label>
        <input
          id={feld("ende")}
          data-testid="feld-ende"
          type="time"
          value={eingabe.ende}
          onChange={(e) => aendern("ende")(e.target.value)}
        />

        <Button type="submit" data-testid="einsatz-speichern" disabled={!vollstaendig || laeuft}>
          {laeuft ? "Wird gespeichert …" : "Entwurf speichern"}
        </Button>
      </form>

      {meldung === null ? null : (
        <p
          id={feld("meldung")}
          data-testid="einsatzformular-meldung"
          data-state={meldung.art}
          role={meldung.art === "erfolg" ? "status" : "alert"}
        >
          {meldung.text}
        </p>
      )}
    </section>
  );
}
