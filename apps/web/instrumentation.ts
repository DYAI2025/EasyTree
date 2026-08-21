/**
 * Startsperre fuer das Proxyziel (EYT-126).
 *
 * `register()` laeuft EINMAL beim Hochfahren des Next-Servers, vor der ersten
 * Anfrage. Wirft es, meldet Next "Failed to prepare server" und beantwortet
 * danach JEDE Route mit 500 — auch `/` und `/anmelden`. Gemessen am 21.08.2026
 * auf Next 16.2.11 im Standalone-Server.
 *
 * Ehrliche Grenze: der Prozess bleibt am Leben und haelt den Port. Er bedient
 * aber keinen normalen Anwendungsverkehr mehr, und der Compose-Healthcheck auf
 * `/` schlaegt fehl, der Container gilt als `unhealthy`. Behaupte nicht, der
 * Container starte nicht.
 *
 * Der Wert wird hier NICHT zwischengespeichert. Die Sperre beantwortet "ist die
 * Umgebung brauchbar", nicht "welches Ziel gilt" — das entscheidet
 * lib/proxy-durchreichen.ts bei jeder Anfrage neu. Aus demselben Grund liest
 * diese Datei die Umgebung nicht selbst: es gibt genau EINE Laufzeitstelle,
 * und die steht in der Positivliste von apps/api/test/secret-surface.test.ts.
 */
import { aktuellesProxyziel } from "./lib/proxy-durchreichen";

export function register(): void {
  const ziel = aktuellesProxyziel();
  console.log(`[web] Proxyziel geprueft: ${ziel}`);
}
