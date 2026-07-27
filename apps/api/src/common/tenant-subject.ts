/**
 * Mandantensubjekt einer Anfrage (EYT-50).
 *
 * ## Was hier entschieden wird, und was ausdruecklich nicht
 *
 * Jede fachliche Route braucht ein Subjekt: die Benutzer-Id aus einem
 * VERIFIZIERTEN Token. Aus ihr leitet die Datenbank alles Weitere ab —
 * `app.current_user_id()` und `app.user_org_ids()` (Migration 0002) lesen
 * ausschliesslich `request.jwt.claims`, und `PgTenantQueryRunner` setzt genau
 * das transaktionslokal.
 *
 * Diese Datei liefert die NAHT, nicht die Pruefung. Die Verifikation eines
 * Supabase-JWT braucht ein Geheimnis, also eine neue Umgebungsvariable — und
 * der kanonische Variablensatz hat laut CLAUDE.md exakt sechs Eintraege, deren
 * Erweiterung sechs Stellen beruehrt. Wichtiger: das vollstaendige Subjekt- und
 * Rollenmodell ist EYT-14 zugeordnet, ausdruecklich und mit Begruendung. Es
 * hier nebenbei zu erfinden hiesse, eine Sicherheitsentscheidung als
 * Nebeneffekt eines Referenzslices zu treffen.
 *
 * ## Deshalb fail-closed statt vorlaeufig offen
 *
 * Die Produktionsimplementierung liefert IMMER `null`. Eine fachliche Route
 * ohne Subjekt antwortet mit 401 — sie laeuft nicht mit einem geratenen
 * Mandanten, und sie laeuft auch nicht "erstmal ohne Pruefung". Das ist keine
 * Bequemlichkeit: eine Route, die ohne Subjekt schreibt, schreibt an RLS
 * vorbei, weil `app.user_org_ids()` ohne Claims leer ist und jede Policy
 * fail-closed greift — der sichtbare Fehler waere ein stiller Datenverlust
 * statt einer Ablehnung.
 *
 * Tests ersetzen den Token per DI, genau wie `DATABASE_PING` (EYT-58). Damit
 * ist der synthetische, berechtigte Planer aus EYT-50 AK1 herstellbar, ohne
 * dass im Produktionscode ein Umgehungsschalter existiert. Ein solcher
 * Schalter — "nur in test aktiv" — waere die naheliegende Alternative und
 * genau die Sorte Konstrukt, die irgendwann versehentlich in einer
 * Produktionskonfiguration landet.
 */

/** DI-Token. Tests ueberschreiben ihn; der Produktionscode kennt nur den Default. */
export const TENANT_SUBJECT_RESOLVER = "TENANT_SUBJECT_RESOLVER";

/**
 * Liefert die verifizierte Benutzer-Id einer Anfrage, oder `null`.
 *
 * `null` heisst ausdruecklich "nicht verifiziert", nicht "anonym erlaubt".
 */
export interface TenantSubjectResolver {
  resolve(request: unknown): string | null;
}

/**
 * Der Produktionsstand: es gibt keine Tokenpruefung, also gibt es kein
 * Subjekt. Jede fachliche Route ist damit geschlossen, bis EYT-14 die
 * Verifikation liefert.
 */
export class UnauthenticatedSubjectResolver implements TenantSubjectResolver {
  /**
   * Der Parameter bleibt in der Signatur, obwohl er ungelesen ist. Ein
   * `resolve()` ohne Argument liesse sich spaeter still zu etwas erweitern,
   * das doch in die Anfrage schaut; so steht im Code, dass die Anfrage
   * vorliegt und bewusst NICHT ausgewertet wird.
   */
  resolve(request: unknown): string | null {
    // Die Anfrage liegt vor und wird bewusst NICHT ausgewertet. Kein Header,
    // kein Cookie, kein Feld im Koerper ist ein Ersatz fuer ein geprueftes
    // Token.
    void request;
    return null;
  }
}
