import { useId, type HTMLAttributes, type ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Optionale sichtbare Überschrift der Karte. */
  title?: string;
  /** Überschriftenebene für die Dokumentstruktur (Default: h2). */
  headingLevel?: "h2" | "h3" | "h4";
  children?: ReactNode;
}

/**
 * Domänenfreier Inhaltscontainer. Rendert als `section`; mit Titel wird sie
 * ueber `aria-labelledby` zur BENANNTEN Region — erst damit taucht eine Karte
 * in der Landmark-Navigation auf (aria-query macht aus `section` nur mit
 * Namen eine `region`; gemessen 05.09.2026). Ohne Titel bleibt sie namenlos,
 * damit keine leere Region entsteht. Die id der Ueberschrift kommt aus
 * `useId`, nicht aus dem `id` der Karte: das gehoert dem Aufrufer.
 */
export function Card({ title, headingLevel = "h2", className, children, ...rest }: CardProps) {
  const Heading = headingLevel;
  const titelId = useId();
  const classes = ["eyt-card", className].filter(Boolean).join(" ");
  return (
    <section
      className={classes}
      {...(title === undefined ? {} : { "aria-labelledby": titelId })}
      {...rest}
    >
      {title !== undefined && (
        <Heading id={titelId} className="eyt-card__title">
          {title}
        </Heading>
      )}
      {children}
    </section>
  );
}
