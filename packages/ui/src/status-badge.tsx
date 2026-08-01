import type { HTMLAttributes, ReactNode } from "react";

/** Semantische Töne aus dem Basisdesign v2.0 §2.1 — keine freien Farben. */
export const STATUS_TONES = ["published", "draft", "danger", "info", "neutral"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

/**
 * Status nie NUR über Farbe (Basisdesign §7): jeder Ton trägt zusätzlich ein
 * geometrisches Zeichen. Kein Emoji — einfache Textglyphen, die Screenreader
 * ignorieren (aria-hidden), weil der TEXT die Aussage trägt.
 */
const TONE_MARK: Record<StatusTone, string> = {
  published: "●",
  draft: "◐",
  danger: "▲",
  info: "◆",
  neutral: "○",
};

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  children: ReactNode;
}

export function StatusBadge({ tone, children, className, ...rest }: StatusBadgeProps): ReactNode {
  return (
    <span
      className={["eyt-status-badge", `eyt-status-badge--${tone}`, className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <span aria-hidden="true" className="eyt-status-badge__mark">
        {TONE_MARK[tone]}
      </span>
      {children}
    </span>
  );
}
