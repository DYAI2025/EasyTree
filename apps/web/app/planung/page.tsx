import { PlanningWindowView } from "../../components/planning-window-view";

/**
 * Referenzansicht des Planungsfensters (EYT-50).
 *
 * Die Woche steht vorerst fest. Eine Wochennavigation gehoert zu EYT-72; sie
 * hier nebenbei zu bauen hiesse, den Slice zu verbreitern, ohne dass ein
 * Kriterium sie verlangt.
 *
 * Der Wert entspricht dem Seed (`supabase/seed.sql`), damit der integrierte
 * Nachweis gegen echte Daten laeuft statt gegen eine leere Woche.
 */
const REFERENZWOCHE = "2026-W32";

export default function PlanungPage() {
  return (
    <main>
      <h1>Planung</h1>
      <PlanningWindowView weekKey={REFERENZWOCHE} />
    </main>
  );
}
