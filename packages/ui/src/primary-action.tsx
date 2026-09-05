import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

export interface PrimaryActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /**
   * Die Aktion LAEUFT gerade (Absenden, Veroeffentlichen, Speichern).
   *
   * Anders als `disabled` nimmt das dem Button weder die Tab-Position noch
   * den Fokus: `aria-busy` und `aria-disabled` sagen es assistiver Technik,
   * Klicks — und damit das Absenden eines Formulars — werden verschluckt, das
   * `disabled`-Attribut bleibt weg. Was ANGEZEIGT wird, entscheidet weiterhin
   * der Aufrufer ueber `children`. Ohne `busy` ist der DOM byte-gleich mit dem
   * vor EYT-160.
   */
  busy?: boolean;
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
  busy,
  onClick,
  ...rest
}: PrimaryActionProps): ReactNode {
  const laeuft = busy === true;
  const klick = (ereignis: MouseEvent<HTMLButtonElement>): void => {
    if (laeuft) {
      // Verschluckt Maus, Tastatur (Enter/Space loesen click aus) und die
      // implizite Formularabsendung ueber diesen Button.
      ereignis.preventDefault();
      return;
    }
    onClick?.(ereignis);
  };
  return (
    <button
      type={type ?? "button"}
      className={["eyt-primary-action", className].filter(Boolean).join(" ")}
      {...(laeuft ? { "aria-busy": true, "aria-disabled": true, "data-busy": "true" } : {})}
      onClick={klick}
      {...rest}
    >
      {children}
    </button>
  );
}
