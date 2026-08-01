/**
 * Port: Passwort-Anmeldung am Auth-Server (EYT-106).
 *
 * Die API ist der EINZIGE Ort, der mit GoTrue spricht — der Browser bekommt
 * nur HttpOnly-Cookies. Fehlerzustaende stecken im Rueckgabetyp, nicht in
 * Exceptions (dieselbe Entscheidung wie GatewayResult im Vertrag).
 */

export interface LoginGrant {
  readonly ok: true;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

export const LOGIN_REJECTIONS = ["INVALID_CREDENTIALS", "AUTH_SERVER_UNAVAILABLE"] as const;
export type LoginRejection = (typeof LOGIN_REJECTIONS)[number];

export interface LoginRejected {
  readonly ok: false;
  readonly reason: LoginRejection;
}

export type LoginResult = LoginGrant | LoginRejected;

export interface PasswordLoginPort {
  grant(email: string, password: string): Promise<LoginResult>;
  /**
   * Widerruft die Sitzung serverseitig. Best effort: ein fehlgeschlagener
   * Widerruf verhindert das Abmelden nicht — die Cookies sind danach weg,
   * und die Liveness-Pruefung faengt widerrufene Sitzungen ohnehin je Anfrage.
   */
  revoke(accessToken: string): Promise<void>;
}

export const PASSWORD_LOGIN = "TENANCY_PASSWORD_LOGIN";
