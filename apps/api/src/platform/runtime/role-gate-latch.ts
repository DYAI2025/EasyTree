/**
 * Fail-closed Rollengate fuer Requestlaufzeiten (EYT-142).
 *
 * ## Warum es das ueberhaupt gibt
 *
 * Auf Node laeuft die Rollenpruefung aus EYT-45 genau einmal im Bootstrap von
 * `main.ts` / `worker.ts` und verhindert den Start. Auf Cloudflare Workers gibt
 * es diesen Bootstrap nicht:
 *
 *  - Der Modulscope darf kein asynchrones I/O ausfuehren. Gemessen in Spike A3:
 *    ein `fetch()` im Modulscope scheitert mit "Disallowed operation called
 *    within global scope".
 *  - Ein I/O-Objekt darf die Requestgrenze nicht ueberleben. Gemessen in Spike
 *    A4: der Versuch endet mit "Cannot perform I/O on behalf of a different
 *    request".
 *
 * Das Gate muss also IM Request laufen — und darf trotzdem nicht bei jedem
 * Request eine neue Verbindung aufmachen.
 *
 * ## Warum KEIN memoisiertes Promise
 *
 * Der naheliegende Bau waere `let laufend: Promise<...> | null`. Genau das ist
 * verboten: ein noch LAUFENDES Promise aus Request A, das Request B awaited,
 * ist das requestuebergreifende I/O-Objekt aus N2/N3. Gespeichert wird deshalb
 * ausschliesslich das ERGEBNIS als einfacher Wert. Zwei gleichzeitige Requests
 * duerfen die Pruefung notfalls doppelt ausfuehren — das ist idempotent und
 * billiger als der Fehler, den die Alternative erzeugt.
 *
 * ## Fail-closed
 *
 * Eine einmal fehlgeschlagene Pruefung wird NICHT erneut versucht. Ein Latch,
 * der es nach einem Fehlschlag wieder probiert, wuerde bei einer kurz
 * unerreichbaren Datenbank irgendwann durchwinken — eine Sicherheitspruefung,
 * die im Zweifel freigibt, ist keine (vgl. `role-privileges.ts`).
 */
import { verifyDatabaseRole, type RolePrivilegeReader } from "../database/role-privileges";

export type RoleGateErgebnis =
  { readonly ok: true } | { readonly ok: false; readonly grund: string };

/** Nur einfache Werte — siehe N3 im Kopfkommentar. */
interface LatchZustand {
  readonly geprueft: boolean;
  readonly bestanden: boolean;
  readonly grund: string | undefined;
}

export interface RoleGateLatch {
  /** Prueft beim ersten Aufruf; danach wird nur noch der gespeicherte Wert gelesen. */
  sicherstellen(): Promise<RoleGateErgebnis>;
  /** Nur fuer den N3-Nachweis im Test: der komplette gespeicherte Zustand. */
  zustandFuerTest(): LatchZustand;
}

export function createRoleGateLatch(read: RolePrivilegeReader): RoleGateLatch {
  let zustand: LatchZustand = { geprueft: false, bestanden: false, grund: undefined };

  return {
    async sicherstellen(): Promise<RoleGateErgebnis> {
      if (zustand.geprueft) {
        return zustand.bestanden
          ? { ok: true }
          : { ok: false, grund: zustand.grund ?? "abgelehnt" };
      }
      try {
        await verifyDatabaseRole(read);
        zustand = { geprueft: true, bestanden: true, grund: undefined };
        return { ok: true };
      } catch (fehler) {
        const grund = fehler instanceof Error ? fehler.message : String(fehler);
        zustand = { geprueft: true, bestanden: false, grund };
        return { ok: false, grund };
      }
    },
    zustandFuerTest(): LatchZustand {
      return zustand;
    },
  };
}
