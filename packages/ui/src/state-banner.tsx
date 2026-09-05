import type { HTMLAttributes, ReactNode } from "react";

export const BANNER_TONES = ["info", "success", "warning", "danger"] as const;
export type BannerTone = (typeof BANNER_TONES)[number];

/**
 * Status nie NUR ueber Farbe (Basisdesign v2.0 §10) — dieselbe Regel und
 * dieselbe Loesung wie in `StatusBadge`: je Ton ein geometrisches Zeichen,
 * fuer Screenreader unsichtbar (aria-hidden), weil der TEXT die Aussage
 * traegt. Vier verschiedene Formen, damit auch ohne Farbsehen vier Toene
 * auseinanderzuhalten sind; `warning` und `danger` trennt die Fuellung,
 * nicht die Farbe. Kein Emoji (Basisdesign §3).
 */
const TONE_MARK: Record<BannerTone, string> = {
  info: "◆",
  success: "●",
  warning: "△",
  danger: "▲",
};

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
 *
 * Das Zeichen steht IM Titel und der Titeltext in einem eigenen Element:
 * `globals.css` macht den Titel zum Block und den Streifen zum Flexcontainer
 * mit `space-between`; ein Zeichen daneben staende auf eigener Zeile oder
 * schoebe den Text in die Mitte, und dieses Paket darf das Stylesheet nicht
 * anpassen. `__title-text` haelt `getByText(titel)` in der Anwendung exakt.
 * Beides misst `test/state-banner.test.tsx`.
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
        <strong className="eyt-state-banner__title">
          <span aria-hidden="true" className="eyt-state-banner__mark">
            {TONE_MARK[tone]}
          </span>{" "}
          <span className="eyt-state-banner__title-text">{title}</span>
        </strong>
        {children === undefined ? null : <div className="eyt-state-banner__detail">{children}</div>}
      </div>
      {action === undefined ? null : <div className="eyt-state-banner__action">{action}</div>}
    </div>
  );
}
