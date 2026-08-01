/**
 * Port der Anmeldung Richtung Web (EYT-106).
 *
 * Dieselbe Bauart wie `planning/gateway.ts`: jede Operation liefert
 * `GatewayResult`, nie ein nacktes Promise — Fehler, Ablehnung und
 * Nichterreichbarkeit gehören zum Vertrag, nicht in Exceptions.
 *
 * ## Warum hier KEIN Idempotenzschlüssel
 *
 * `login`/`logout` sind Sitzungsoperationen, keine fachlichen Schreibvorgänge:
 * ein wiederholtes Login erzeugt keine zweite Fachtatsache, sondern dieselbe
 * Sitzung erneut. Der Pflicht-Idempotenzschlüssel aus `WriteOptions` bleibt
 * fachlichen Kommandos (Satzversion anlegen, Snapshot erzeugen) vorbehalten.
 */
import type { GatewayResult } from "../gateway.js";
import type { LoginCommand, SessionDto } from "./schemas.js";

export interface AuthGateway {
  /** Meldet an; der Server setzt HttpOnly-Cookies, der Port sieht sie nie. */
  login(command: LoginCommand): Promise<GatewayResult<SessionDto>>;
  /** Beendet die Sitzung serverseitig und löscht die Cookies. */
  logout(): Promise<GatewayResult<null>>;
  /** Liefert die aktuelle Sitzung — oder UNAUTHENTICATED. */
  session(): Promise<GatewayResult<SessionDto>>;
}
