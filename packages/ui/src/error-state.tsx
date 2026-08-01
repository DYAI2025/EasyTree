import type { HTMLAttributes, ReactNode } from "react";

export interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  /** Der Grund in Nutzersprache — nie eine rohe Bibliotheks- oder SQL-Meldung. */
  description: string;
  /** Wiederholen-Aktion; Pflicht, wenn ein erneuter Versuch sinnvoll ist. */
  onRetry?: () => void;
  retryLabel?: string;
}

/** Fehlerzustand (Basisdesign v2.0 §4): assertiv, mit sichtbarem Weg zurück. */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
  ...rest
}: ErrorStateProps): ReactNode {
  return (
    <div
      role="alert"
      className={["eyt-error-state", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <p className="eyt-error-state__title">{title}</p>
      <p className="eyt-error-state__description">{description}</p>
      {onRetry === undefined ? null : (
        <button type="button" className="eyt-error-state__retry" onClick={onRetry}>
          {retryLabel ?? "Erneut versuchen"}
        </button>
      )}
    </div>
  );
}
