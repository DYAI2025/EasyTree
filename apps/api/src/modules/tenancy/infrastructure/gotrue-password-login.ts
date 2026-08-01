/**
 * GoTrue-Adapter der Passwort-Anmeldung (EYT-106).
 *
 * `POST <SUPABASE_URL>/auth/v1/token?grant_type=password` mit anon-Key.
 * 200 liefert access_token/refresh_token/expires_in; 400/401 heisst falsche
 * Zugangsdaten (GoTrue antwortet auf invalid_grant mit 400); alles andere
 * ist Nichterreichbarkeit — und wird als solche benannt, nicht geraten.
 *
 * Kein Passwort und kein Token erscheint je in einer Meldung oder einem Log.
 */
import type { LoginResult, PasswordLoginPort } from "../application/password-login.port";

export interface GotruePasswordLoginInput {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly fetchImpl: typeof fetch;
}

interface GrantResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
}

export class GotruePasswordLogin implements PasswordLoginPort {
  constructor(private readonly input: GotruePasswordLoginInput) {}

  async grant(email: string, password: string): Promise<LoginResult> {
    let antwort: Response;
    try {
      antwort = await this.input.fetchImpl(
        `${this.input.supabaseUrl}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            apikey: this.input.anonKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        },
      );
    } catch {
      return { ok: false, reason: "AUTH_SERVER_UNAVAILABLE" };
    }

    if (antwort.status === 400 || antwort.status === 401 || antwort.status === 403) {
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }
    if (antwort.status !== 200) {
      return { ok: false, reason: "AUTH_SERVER_UNAVAILABLE" };
    }

    let daten: GrantResponse;
    try {
      daten = (await antwort.json()) as GrantResponse;
    } catch {
      return { ok: false, reason: "AUTH_SERVER_UNAVAILABLE" };
    }
    if (
      typeof daten.access_token !== "string" ||
      typeof daten.refresh_token !== "string" ||
      typeof daten.expires_in !== "number"
    ) {
      // 200 mit unerwartetem Koerper: gebrochener Vertrag, kein Login.
      return { ok: false, reason: "AUTH_SERVER_UNAVAILABLE" };
    }
    return {
      ok: true,
      accessToken: daten.access_token,
      refreshToken: daten.refresh_token,
      expiresInSeconds: daten.expires_in,
    };
  }

  async revoke(accessToken: string): Promise<void> {
    try {
      await this.input.fetchImpl(`${this.input.supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: this.input.anonKey,
          authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      // Best effort — die geloeschten Cookies beenden die Browsersitzung,
      // und die Liveness-Pruefung faengt widerrufene Sitzungen je Anfrage.
    }
  }
}
