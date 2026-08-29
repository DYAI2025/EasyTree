/**
 * Selector-Cookie der Organisationsauswahl (EYT-113 Inkrement 2).
 *
 * Der Wert ist eine AUSWAHL, kein Geheimnis und keine Autorisierung: der
 * Server prueft ihn ausschliesslich gegen die real verifizierte Session
 * (lib/kosten-freigabe.ts) — eine fremde Id faellt dort wirkungslos.
 *
 * Bewusst NICHT HttpOnly (der Client schreibt es), KEIN Secure (laeuft
 * lokal auf blankem http; der Wert ist kein Geheimnis), KEIN Max-Age beim
 * Schreiben (Session-Cookie).
 */
export const ORG_AUSWAHL_COOKIE = "eyt_org";

export function liesOrgAuswahl(cookieHeader: string | null): string | null {
  if (cookieHeader === null || cookieHeader === "") return null;
  for (const teil of cookieHeader.split(";")) {
    const gleich = teil.indexOf("=");
    if (gleich === -1) continue;
    if (teil.slice(0, gleich).trim() !== ORG_AUSWAHL_COOKIE) continue;
    const wert = teil.slice(gleich + 1).trim();
    if (wert === "") return null;
    // Kaputte Prozentkodierung (z. B. `eyt_org=%`) laesst decodeURIComponent
    // mit URIError werfen — und die Kompositionswurzel liest den Selector
    // beim Client-Start. Fail-closed heisst hier: kein Wert, keine Ausnahme;
    // kein Rueckfall, keine Normalisierung in eine gueltige Organisation.
    try {
      return decodeURIComponent(wert);
    } catch {
      return null;
    }
  }
  return null;
}

export function liesOrgAuswahlAusDokument(): string | null {
  if (typeof document === "undefined") return null;
  return liesOrgAuswahl(document.cookie);
}

export function schreibeOrgAuswahl(id: string | null): void {
  if (typeof document === "undefined") return;
  document.cookie =
    id === null
      ? `${ORG_AUSWAHL_COOKIE}=; path=/; SameSite=Lax; Max-Age=0`
      : `${ORG_AUSWAHL_COOKIE}=${encodeURIComponent(id)}; path=/; SameSite=Lax`;
}
