import { PlanningWindowQuerySchema } from "@easytree/contracts";

import { PlanningWindowView } from "../../components/planning-window-view";

/**
 * Referenzansicht des Planungsfensters (EYT-50).
 *
 * Die Woche kommt aus der URL: `/planung?weekKey=2026-W32`.
 *
 * Hier stand zuvor eine Konstante `REFERENZWOCHE = "2026-W32"` — der Wert aus
 * dem Seed. Ein Produktionscode, der eine Testwoche kennt, zeigt in jeder
 * anderen Umgebung stillschweigend die falsche; und ein Browsertest, der ihn
 * nicht setzen kann, prueft nicht den Parameterpfad.
 *
 * Kein stiller Default: fehlt oder faellt der Wert durch die Vertragspruefung,
 * wird das SICHTBAR und das Gateway gar nicht erst gerufen. Eine
 * Wochennavigation bleibt EYT-72.
 */
export default async function PlanungPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const roh = params["weekKey"];
  // Mehrfach angegebener Parameter ist keine gueltige Woche, sondern eine
  // mehrdeutige Angabe — und die wird abgelehnt statt stillschweigend auf den
  // ersten Wert reduziert.
  const query = PlanningWindowQuerySchema.safeParse({
    weekKey: typeof roh === "string" ? roh : undefined,
  });

  return (
    <main>
      <h1>Planung</h1>
      {query.success ? (
        <PlanningWindowView weekKey={query.data.weekKey} />
      ) : (
        <p data-testid="planungsfenster-parameterfehler" role="alert">
          Kein gültiger Wochenschlüssel. Erwartet wird `?weekKey=2026-W32` mit einer Woche zwischen
          01 und 53.
        </p>
      )}
    </main>
  );
}
