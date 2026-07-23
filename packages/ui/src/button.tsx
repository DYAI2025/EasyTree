import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Rein visuelle Variante — keine Semantik, keine Domainbedeutung. */
  variant?: ButtonVariant;
}

/**
 * Domänenfreier Button. Erzwingt `type="button"` als Default, damit
 * Buttons in Formularen nicht versehentlich submitten.
 */
export function Button({ variant = "primary", type = "button", className, ...rest }: ButtonProps) {
  const classes = ["eyt-button", `eyt-button--${variant}`, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
