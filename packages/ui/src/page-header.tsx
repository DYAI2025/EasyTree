import type { HTMLAttributes, ReactNode } from "react";

export interface PageHeaderProps extends HTMLAttributes<HTMLElement> {
  /** Seitentitel — genau eine h1 je Seite (Basisdesign v2.0 §2.2). */
  title: string;
  /** Optionale Unterzeile unter dem Titel. */
  description?: string;
  /** Rechtsbuendiger Aktionsbereich — hier lebt der EINE primaere CTA. */
  actions?: ReactNode;
}

/**
 * Seitenkopf der Werkbank (Basisdesign v2.0). Domänenfrei: Titel, optionale
 * Beschreibung, Aktionsbereich. Styling liegt in der App (`globals.css`).
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
  ...rest
}: PageHeaderProps): ReactNode {
  return (
    <header className={["eyt-page-header", className].filter(Boolean).join(" ")} {...rest}>
      <div className="eyt-page-header__text">
        <h1 className="eyt-page-header__title">{title}</h1>
        {description === undefined ? null : (
          <p className="eyt-page-header__description">{description}</p>
        )}
      </div>
      {actions === undefined ? null : <div className="eyt-page-header__actions">{actions}</div>}
    </header>
  );
}
