import { join } from "node:path";

import { REISENDER_A, REISENDER_B, psqlMitMarker } from "./global-setup";

/**
 * Entfernt die Reisedaten wieder (EYT-106 AK8, EYT-134).
 *
 * Teilt sich `psqlMitMarker` mit dem Setup — dieselbe Zusage, dieselbe
 * Strenge: Exit-Code ungleich 0 ist rot, beide Ausgabestroeme werden
 * durchsucht, ein fehlender Marker WIRFT statt weiterzulaufen. Eine fruehere
 * Fassung druckte bei fehlendem Marker eine Notiz und endete mit 0; im
 * CI-Log stand dann das eigene Versagen, und der Job galt als bestanden.
 *
 * Idempotent: `teardown.sql` loescht nach festen IDs und nach den beiden
 * Adressen. Ein zweiter Lauf findet nichts mehr und meldet trotzdem
 * `restzeilen=0`. Deshalb faehrt der CI-Job dieselbe Datei zusaetzlich unter
 * `if: always()` — das faengt den Fall ab, in dem Playwright abstuerzt, bevor
 * dieser Teardown an die Reihe kommt.
 */
const HIER = __dirname;

export default function globalTeardown(): void {
  const datenbankUrl = process.env["EASYTREE_JOURNEY_ADMIN_DB_URL"];
  if (datenbankUrl === undefined || datenbankUrl === "") {
    // Kein stilles Weiterlaufen: ohne Verbindung kann nicht aufgeraeumt
    // werden, und ein anmeldbarer Benutzer bliebe zurueck.
    throw new Error("[auth-journey] EASYTREE_JOURNEY_ADMIN_DB_URL fehlt — nichts geraeumt.");
  }
  const marker = psqlMitMarker(
    datenbankUrl,
    join(HIER, "teardown.sql"),
    ["-v", `reisender_a=${REISENDER_A}`, "-v", `reisender_b=${REISENDER_B}`],
    "[auth-journey-teardown]",
  );
  console.log(`  ${marker}`);
}
