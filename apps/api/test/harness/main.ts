/**
 * Prozess-Einstieg des Harness-Servers (EYT-50).
 *
 * Wird vom CI-Job gestartet und per SIGTERM beendet. Die Identitaet kommt aus
 * dem Aufruf, nicht aus einer Anfrage — deshalb ist sie ein Argument und keine
 * Umgebungsvariable, die man versehentlich auch woanders setzt.
 */
import { startHarnessApi } from "./server";

const subjectUserId = process.argv[2];
const port = Number(process.argv[3]);

if (subjectUserId === undefined || Number.isNaN(port)) {
  console.error("Aufruf: node harness/main.js <subjectUserId> <port>");
  process.exit(2);
}

void startHarnessApi({ subjectUserId, port }).then((app) => {
  const beenden = (): void => {
    void app.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", beenden);
  process.on("SIGINT", beenden);
  console.log(`[harness] API auf ${port} als ${subjectUserId}`);
});
