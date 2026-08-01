import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface PrimaryActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/**
 * DER eine primäre CTA einer Ansicht (Basisdesign v2.0 §2.3: genau einer pro
 * Screen, Desktop ≥40 px). Eine eigene Komponente statt `Button
 * variant="primary"`, damit die Regel "einer pro Ansicht" im Review sichtbar
 * bleibt: zwei `PrimaryAction` in einer Ansicht fallen auf, zwei
 * primary-Buttons nicht.
 */
export function PrimaryAction({
  children,
  className,
  type,
  ...rest
}: PrimaryActionProps): ReactNode {
  return (
    <button
      type={type ?? "button"}
      className={["eyt-primary-action", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
