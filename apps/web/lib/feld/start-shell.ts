import type { SessionDto } from "@easytree/contracts";

/**
 * Start-Shell-Ableitung (EYT-113).
 *
 * Die zulaessige Start-Shell folgt aus der serverseitig verifizierten Session,
 * konkret aus den Mitgliedschaftsrollen: Wer in KEINER Organisation eine
 * Leitungsrolle (owner/manager) traegt, arbeitet im Feld. Eine einzige
 * Leitungsrolle genuegt fuer die Werkbank, denn nur dort existieren die
 * Flaechen, die diese Rolle bedienen kann.
 *
 * Bewusst Rollen statt Permissions: `role_permissions` ist globale
 * Konfiguration und kann wachsen (z. B. kuenftige Mitarbeiter-Rechte fuer
 * EYT-81); die Rollentrennung member/leitung bleibt davon unberuehrt.
 *
 * Ein Nutzer ohne jede Mitgliedschaft faellt ins Feld: die kleinste Flaeche,
 * auf der jede Ansicht ohne Organisation ehrlich leer bleibt.
 */
export type StartShell = "feld" | "werkbank";

export function startShellFuer(session: SessionDto): StartShell {
  const leitung = session.organisations.some(
    (organisation) => organisation.role === "owner" || organisation.role === "manager",
  );
  return leitung ? "werkbank" : "feld";
}
