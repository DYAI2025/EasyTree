"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  newIdempotencyKey,
  type EmployeeForRatesDto,
  type GatewayFailure,
  type RateHistory,
} from "@easytree/contracts";
import {
  Card,
  EmptyState,
  ErrorState,
  PrimaryAction,
  StateBanner,
  StatusBadge,
} from "@easytree/ui";

import { useCostsGateway } from "../lib/costs-gateway-provider";
import { euroToMinorUnits, minorUnitsToEuro } from "../lib/euro-minor-units";

/**
 * Stundensatzverwaltung (EYT-108, Basisdesign §5 Punkt 3).
 *
 * Alle Daten kommen ueber das CostsGateway aus der echten API — kein Mock,
 * kein LocalStorage. Der primaere CTA legt IMMER eine neue Version an;
 * "ueberschreiben" existiert weder als Wort noch als Pfad. Nach dem
 * Speichern wird die Historie NEU GELADEN — kein optimistisches Vortaeuschen.
 */

const LADEFEHLER: Record<GatewayFailure, string> = {
  UNAUTHENTICATED: "Die Sitzung ist abgelaufen. Bitte neu anmelden.",
  FORBIDDEN: "Deine Rolle darf Stundensätze nicht einsehen.",
  UNAVAILABLE: "Der Server ist nicht erreichbar.",
  CONTRACT_VIOLATION: "Die Antwort des Servers war unerwartet.",
  STALE_VERSION: "Der Stand war veraltet.",
  REJECTED:
    "Der Server kennt diesen Endpunkt noch nicht — die Satz-API wird in diesem Sprint angeschlossen.",
};

const SPEICHERFEHLER: Record<GatewayFailure, string> = {
  ...LADEFEHLER,
  FORBIDDEN: "Deine Rolle darf keine Satzversionen anlegen (costs.manage_rates fehlt).",
  STALE_VERSION:
    "Konkurrierende Änderung erkannt: der aktive Satz hat sich geändert oder das Intervall überlappt. Die Historie wurde neu geladen — bitte prüfen und erneut entscheiden.",
  REJECTED: "Der Server hat die Version abgelehnt. Bitte Eingaben prüfen.",
};

type MitarbeiterZustand =
  | { art: "laedt" }
  | { art: "fehler"; grund: GatewayFailure }
  | { art: "geladen"; mitarbeiter: readonly EmployeeForRatesDto[] };

type HistorieZustand =
  | { art: "keiner" }
  | { art: "laedt" }
  | { art: "fehler"; grund: GatewayFailure }
  | { art: "geladen"; historie: RateHistory };

type SpeicherZustand =
  | { art: "bereit" }
  | { art: "speichert" }
  | { art: "erfolg"; versionId: string }
  | { art: "eingabefehler"; text: string }
  | { art: "fehler"; grund: GatewayFailure };

export function RateManagement() {
  const gateway = useCostsGateway();
  const [mitarbeiter, setMitarbeiter] = useState<MitarbeiterZustand>({ art: "laedt" });
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [historie, setHistorie] = useState<HistorieZustand>({ art: "keiner" });
  const [speichern, setSpeichern] = useState<SpeicherZustand>({ art: "bereit" });
  const [mitarbeiterLauf, setMitarbeiterLauf] = useState(0);
  const [historieLauf, setHistorieLauf] = useState(0);

  useEffect(() => {
    let abgebrochen = false;
    setMitarbeiter({ art: "laedt" });
    void gateway.listEmployees().then((ergebnis) => {
      if (abgebrochen) return;
      setMitarbeiter(
        ergebnis.ok
          ? { art: "geladen", mitarbeiter: ergebnis.value.employees }
          : { art: "fehler", grund: ergebnis.failure },
      );
    });
    return () => {
      abgebrochen = true;
    };
  }, [gateway, mitarbeiterLauf]);

  useEffect(() => {
    if (gewaehlt === null) {
      setHistorie({ art: "keiner" });
      return;
    }
    let abgebrochen = false;
    setHistorie({ art: "laedt" });
    void gateway.rateHistory(gewaehlt).then((ergebnis) => {
      if (abgebrochen) return;
      setHistorie(
        ergebnis.ok
          ? { art: "geladen", historie: ergebnis.value }
          : { art: "fehler", grund: ergebnis.failure },
      );
    });
    return () => {
      abgebrochen = true;
    };
  }, [gateway, gewaehlt, historieLauf]);

  const absenden = useCallback(
    async (ereignis: FormEvent<HTMLFormElement>) => {
      ereignis.preventDefault();
      if (gewaehlt === null) return;
      const formular = new FormData(ereignis.currentTarget);

      const betrag = euroToMinorUnits(String(formular.get("betrag") ?? ""));
      if (betrag === null) {
        setSpeichern({
          art: "eingabefehler",
          text: "Betrag bitte als EUR-Wert angeben, z. B. 38,50.",
        });
        return;
      }
      const validFrom = String(formular.get("gueltigAb") ?? "");
      const validTo = String(formular.get("gueltigBis") ?? "");
      const reason = String(formular.get("grund") ?? "").trim();
      if (reason === "") {
        setSpeichern({ art: "eingabefehler", text: "Der Änderungsgrund ist Pflicht." });
        return;
      }

      const aktiveVersion = historie.art === "geladen" ? historie.historie.activeVersionId : null;

      setSpeichern({ art: "speichert" });
      const ergebnis = await gateway.createRateVersion(
        {
          employeeId: gewaehlt,
          amountMinorUnits: betrag,
          currency: "EUR",
          validFrom,
          validTo: validTo === "" ? null : validTo,
          reason,
          expectedActiveVersionId: aktiveVersion,
        },
        { idempotencyKey: newIdempotencyKey() },
      );

      if (!ergebnis.ok) {
        setSpeichern({ art: "fehler", grund: ergebnis.failure });
        if (ergebnis.failure === "STALE_VERSION") {
          // Konkurrierende Aenderung: Serverstand neu laden, Entscheidung
          // liegt bei der Person — nie still ueberschreiben.
          setHistorieLauf((lauf) => lauf + 1);
        }
        return;
      }

      // Kein Optimismus: neue Version, aktive Version und Historie werden
      // vom Server NEU gelesen; erst dann gilt der Vorgang als sichtbar.
      setSpeichern({ art: "erfolg", versionId: ergebnis.value.id });
      setHistorieLauf((lauf) => lauf + 1);
    },
    [gateway, gewaehlt, historie],
  );

  if (mitarbeiter.art === "laedt") {
    return (
      <p role="status" data-testid="saetze-laedt">
        Mitarbeiter werden geladen …
      </p>
    );
  }
  if (mitarbeiter.art === "fehler") {
    return (
      <ErrorState
        title="Mitarbeiterliste nicht verfügbar"
        description={LADEFEHLER[mitarbeiter.grund]}
        onRetry={() => setMitarbeiterLauf((lauf) => lauf + 1)}
      />
    );
  }
  if (mitarbeiter.mitarbeiter.length === 0) {
    return (
      <EmptyState
        title="Keine Mitarbeiter vorhanden"
        description="Für Stundensätze braucht es zuerst Mitarbeitende in dieser Organisation."
      />
    );
  }

  return (
    <div className="eyt-rate-management">
      <Card title="Mitarbeiter">
        <div className="eyt-form__field">
          <label htmlFor="satz-mitarbeiter">Mitarbeiter auswählen</label>
          <select
            id="satz-mitarbeiter"
            value={gewaehlt ?? ""}
            onChange={(ereignis) => {
              setGewaehlt(ereignis.target.value === "" ? null : ereignis.target.value);
              setSpeichern({ art: "bereit" });
            }}
          >
            <option value="">Bitte wählen</option>
            {mitarbeiter.mitarbeiter.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
                {person.active ? "" : " (inaktiv)"}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {gewaehlt === null ? null : (
        <>
          <Card title="Neue Satzversion anlegen">
            {speichern.art === "erfolg" ? (
              <StateBanner tone="success" title="Version erfolgreich angelegt">
                Die neue Satzversion ist gespeichert und unten in der Historie sichtbar.
              </StateBanner>
            ) : null}
            {speichern.art === "eingabefehler" ? (
              <StateBanner tone="warning" title="Eingabe prüfen">
                {speichern.text}
              </StateBanner>
            ) : null}
            {speichern.art === "fehler" ? (
              <StateBanner
                tone={speichern.grund === "STALE_VERSION" ? "warning" : "danger"}
                title={
                  speichern.grund === "STALE_VERSION"
                    ? "Konkurrierende Änderung erkannt"
                    : "Nicht gespeichert"
                }
              >
                {SPEICHERFEHLER[speichern.grund]}
              </StateBanner>
            ) : null}

            <form className="eyt-form" onSubmit={absenden} data-testid="satzformular">
              <div className="eyt-form__row">
                <div className="eyt-form__field">
                  <label htmlFor="satz-betrag">Betrag (EUR pro Stunde)</label>
                  <input
                    id="satz-betrag"
                    name="betrag"
                    inputMode="decimal"
                    placeholder="38,50"
                    required
                    disabled={speichern.art === "speichert"}
                  />
                </div>
                <div className="eyt-form__field">
                  <label htmlFor="satz-gueltig-ab">Gültig ab</label>
                  <input
                    id="satz-gueltig-ab"
                    name="gueltigAb"
                    type="date"
                    required
                    disabled={speichern.art === "speichert"}
                  />
                </div>
                <div className="eyt-form__field">
                  <label htmlFor="satz-gueltig-bis">Gültig bis (optional)</label>
                  <input
                    id="satz-gueltig-bis"
                    name="gueltigBis"
                    type="date"
                    disabled={speichern.art === "speichert"}
                  />
                </div>
              </div>
              <div className="eyt-form__field">
                <label htmlFor="satz-grund">Änderungsgrund</label>
                <input
                  id="satz-grund"
                  name="grund"
                  required
                  maxLength={500}
                  placeholder="z. B. Tariferhöhung zum Quartal"
                  disabled={speichern.art === "speichert"}
                />
              </div>
              <PrimaryAction type="submit" disabled={speichern.art === "speichert"}>
                {speichern.art === "speichert" ? "Wird gespeichert …" : "Neue Satzversion anlegen"}
              </PrimaryAction>
            </form>
          </Card>

          <Card title="Versionshistorie">
            {historie.art === "laedt" || historie.art === "keiner" ? (
              <p role="status">Historie wird geladen …</p>
            ) : historie.art === "fehler" ? (
              <ErrorState
                title="Historie nicht verfügbar"
                description={LADEFEHLER[historie.grund]}
                onRetry={() => setHistorieLauf((lauf) => lauf + 1)}
              />
            ) : historie.historie.versions.length === 0 ? (
              <EmptyState
                data-testid="satz-fehlt"
                title="Kein Stundensatz hinterlegt"
                description="Für diese Person existiert noch keine Satzversion. Ohne Satz kann keine Kostenberechnung laufen — sie wird blockiert, nicht mit 0,00 € geraten."
              />
            ) : (
              <table className="eyt-table" data-testid="satzhistorie">
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">Betrag</th>
                    <th scope="col">Gültig ab</th>
                    <th scope="col">Gültig bis</th>
                    <th scope="col">Grund</th>
                    <th scope="col">Angelegt</th>
                  </tr>
                </thead>
                <tbody>
                  {historie.historie.versions.map((version) => (
                    <tr key={version.id}>
                      <td>
                        {version.id === historie.historie.activeVersionId ? (
                          <StatusBadge tone="published">aktiv</StatusBadge>
                        ) : version.status === "kommend" ? (
                          <StatusBadge tone="draft">kommend</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">abgelaufen</StatusBadge>
                        )}
                      </td>
                      <td className="eyt-table__amount">
                        {minorUnitsToEuro(version.amountMinorUnits)} €
                      </td>
                      <td>{version.validFrom}</td>
                      <td>{version.validTo ?? "—"}</td>
                      <td>{version.reason}</td>
                      <td>{version.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
