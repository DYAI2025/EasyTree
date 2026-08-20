import type { HTMLAttributes, ReactNode } from "react";

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Was geladen wird — nie bloss "Lädt". Der Satz benennt den Gegenstand. */
  label: string;
}

/**
 * Ladezustand (Basisdesign v2.0 §4), der fuenfte wiederverwendbare Zustand
 * neben `EmptyState`, `ErrorState`, `StateBanner` und `StatusBadge`.
 *
 * ## Warum er ueberhaupt ein Baustein ist
 *
 * Planung und Kosten hatten ihn je einzeln als `<p role="status">…</p>`
 * ausgeschrieben — vier Stellen, vier Formulierungen, und `role="status"`
 * haette an einer davon fehlen koennen, ohne dass etwas rot geworden waere.
 * EYT-141 verlangt Loading als WIEDERVERWENDBAREN Zustand; genau das ist der
 * Unterschied zwischen "es steht ueberall etwas" und "es ist eine Zusage".
 *
 * ## Warum `role="status"` und nicht `alert`
 *
 * Warten ist keine Stoerung. `status` ist hoeflich (`aria-live="polite"`), der
 * Screenreader unterbricht die Nutzerin nicht mitten im Satz. `aria-busy`
 * sagt zusaetzlich, dass der Bereich gerade arbeitet — das ist die
 * maschinenlesbare Haelfte derselben Aussage.
 *
 * Ein Spinner ohne Text waere hier falsch: er traegt die Aussage NUR ueber
 * Bewegung, und Basisdesign v2.0 §7 verlangt sie zusaetzlich in Text.
 */
export function LoadingState({ label, className, ...rest }: LoadingStateProps): ReactNode {
  return (
    <div
      role="status"
      aria-busy="true"
      className={["eyt-loading-state", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span aria-hidden="true" className="eyt-loading-state__mark">
        ◌
      </span>
      <span className="eyt-loading-state__label">{label}</span>
    </div>
  );
}
