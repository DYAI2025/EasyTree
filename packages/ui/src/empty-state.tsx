import type { HTMLAttributes, ReactNode } from "react";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  /** Erklärt, WARUM leer, und was als Nächstes sinnvoll ist — nie nur "leer". */
  description: string;
  action?: ReactNode;
}

/**
 * Leerzustand (Basisdesign v2.0 §4). Bewusst fail-sichtbar: er sagt, warum
 * nichts da ist, statt still zu bleiben — dieselbe Eigenschaft wie die
 * Inline-Zustände der Planungsansicht, nur wiederverwendbar.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
  ...rest
}: EmptyStateProps): ReactNode {
  return (
    <div
      role="status"
      className={["eyt-empty-state", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <p className="eyt-empty-state__title">{title}</p>
      <p className="eyt-empty-state__description">{description}</p>
      {action === undefined ? null : <div className="eyt-empty-state__action">{action}</div>}
    </div>
  );
}
