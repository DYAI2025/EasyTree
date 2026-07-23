import type { CSSProperties, HTMLAttributes } from "react";

export type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement>;

/**
 * Etabliertes 1px-Clip-Muster: Inhalt bleibt für Screenreader im
 * Accessibility-Tree, ist aber visuell nicht sichtbar. Bewusst KEIN
 * `display: none` / `visibility: hidden` (das entfernt Inhalte auch
 * für assistive Technologien). Inline-Styles, damit das Primitive ohne
 * CSS-Import überall funktioniert.
 */
const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function VisuallyHidden({ style, ...rest }: VisuallyHiddenProps) {
  return <span style={{ ...visuallyHiddenStyle, ...style }} {...rest} />;
}
