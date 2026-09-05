import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Optionale sichtbare Überschrift der Karte. */
  title?: string;
  /** Überschriftenebene für die Dokumentstruktur (Default: h2). */
  headingLevel?: "h2" | "h3" | "h4";
  children?: ReactNode;
}

/**
 * Domänenfreier Inhaltscontainer. Rendert als `section`, damit Karten
 * mit Titel als benannte Region in der Landmark-/Outline-Struktur
 * auftauchen können.
 */
export function Card({ title, headingLevel = "h2", className, children, ...rest }: CardProps) {
  const Heading = headingLevel;
  const classes = ["eyt-card", className].filter(Boolean).join(" ");
  return (
    <section className={classes} {...rest}>
      {title !== undefined && <Heading className="eyt-card__title">{title}</Heading>}
      {children}
    </section>
  );
}
