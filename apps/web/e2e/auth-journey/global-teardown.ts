import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REISENDER_EMAIL } from "./global-setup";

/**
 * Entfernt die Reisedaten wieder (EYT-106 AK8, EYT-134).
 *
 * Idempotent: `teardown.sql` loescht nach festen IDs und nach der
 * Reisenden-Adresse; ein zweiter Lauf findet nichts mehr und meldet
 * `restzeilen=0`. Deshalb darf der CI-Job dieselbe Datei zusaetzlich mit
 * `if: always()` fahren — das faengt den Fall ab, in dem Playwright abstuerzt,
 * bevor `globalTeardown` an die Reihe kommt.
 */
const HIER = dirname(fileURLToPath(import.meta.url));

export default function globalTeardown(): void {
  const datenbankUrl = process.env["EASYTREE_JOURNEY_ADMIN_DB_URL"];
  if (datenbankUrl === undefined || datenbankUrl === "") {
    console.warn("[auth-journey-teardown] EASYTREE_JOURNEY_ADMIN_DB_URL fehlt — nichts geraeumt.");
    return;
  }
  const ausgabe = execFileSync(
    "psql",
    [
      datenbankUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `reisender=${REISENDER_EMAIL}`,
      "-f",
      join(HIER, "teardown.sql"),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const zeile = /\[auth-journey-teardown\][^\n]*/.exec(ausgabe);
  console.log(zeile?.[0] ?? "[auth-journey-teardown] (keine Bestaetigungszeile gefunden)");
}
