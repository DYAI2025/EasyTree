import type { HTMLAttributes, ReactNode } from "react";

export const BANNER_TONES = ["info", "success", "warning", "danger"] as const;
export type BannerTone = (typeof BANNER_TONES)[number];

export interface StateBannerProps extends HTMLAttributes<HTMLDivElement> {
  tone: BannerTone;
  title: string;
  children?: ReactNode;
  /** Optionale Aktion (z. B. "Neu laden") — gehört zum Zustand, nicht daneben. */
  action?: ReactNode;
}

/**
 * Sichtbarer Zustandsstreifen (Basisdesign v2.0 §4): Stale, Erfolg nach dem
 * Speichern, Warnungen. `danger`/`warning` melden sich assertiv (role=alert),
 * Info und Erfolg höflich (role=status) — Screenreader-Reihenfolge bleibt
 * die sichtbare Reihenfolge.
 */
export function StateBanner({
  tone,
  title,
  children,
  action,
  className,
  ...rest
}: StateBannerProps): ReactNode {
  const assertiv = tone === "danger" || tone === "warning";
  return (
    <div
      role={assertiv ? "alert" : "status"}
      className={["eyt-state-banner", `eyt-state-banner--${tone}`, className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <div className="eyt-state-banner__text">
        <strong className="eyt-state-banner__title">{title}</strong>
        {children === undefined ? null : <div className="eyt-state-banner__detail">{children}</div>}
      </div>
      {action === undefined ? null : <div className="eyt-state-banner__action">{action}</div>}
    </div>
  );
}
