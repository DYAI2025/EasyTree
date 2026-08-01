"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { GatewayFailure } from "@easytree/contracts";
import { PrimaryAction, StateBanner } from "@easytree/ui";

import { useAuthGateway } from "../lib/auth-gateway-provider";
import { useSession } from "../lib/session-provider";

/** Vollstaendig, ohne Default-Zweig — dieselbe Regel wie in der Planung. */
const FEHLERTEXT: Record<GatewayFailure, string> = {
  UNAUTHENTICATED: "E-Mail oder Passwort ist falsch.",
  UNAVAILABLE: "Der Anmeldedienst ist gerade nicht erreichbar. Bitte später erneut versuchen.",
  CONTRACT_VIOLATION: "Die Antwort des Servers war unerwartet. Bitte erneut versuchen.",
  FORBIDDEN: "Diese Anmeldung ist nicht zugelassen.",
  STALE_VERSION: "Unerwarteter Zustand. Bitte erneut versuchen.",
  REJECTED: "Die Anmeldung wurde abgelehnt. Bitte Eingaben prüfen.",
};

type Zustand = { art: "eingabe" } | { art: "sendet" } | { art: "fehler"; grund: GatewayFailure };

export function LoginForm() {
  const gateway = useAuthGateway();
  const { neuLaden } = useSession();
  const router = useRouter();
  const [zustand, setZustand] = useState<Zustand>({ art: "eingabe" });

  async function absenden(ereignis: FormEvent<HTMLFormElement>): Promise<void> {
    ereignis.preventDefault();
    const formular = new FormData(ereignis.currentTarget);
    const email = String(formular.get("email") ?? "");
    const password = String(formular.get("password") ?? "");

    setZustand({ art: "sendet" });
    const ergebnis = await gateway.login({ email, password });
    if (!ergebnis.ok) {
      setZustand({ art: "fehler", grund: ergebnis.failure });
      return;
    }
    // Kein Optimismus: die Sitzung wird NEU vom Server geladen, dann Weiterleitung.
    neuLaden();
    router.push("/kosten");
  }

  return (
    <form className="eyt-form eyt-login-form" onSubmit={absenden} data-testid="anmeldeformular">
      {zustand.art === "fehler" ? (
        <StateBanner tone="danger" title="Anmeldung fehlgeschlagen">
          {FEHLERTEXT[zustand.grund]}
        </StateBanner>
      ) : null}
      <div className="eyt-form__field">
        <label htmlFor="anmelden-email">E-Mail</label>
        <input
          id="anmelden-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={zustand.art === "sendet"}
        />
      </div>
      <div className="eyt-form__field">
        <label htmlFor="anmelden-passwort">Passwort</label>
        <input
          id="anmelden-passwort"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={zustand.art === "sendet"}
        />
      </div>
      <PrimaryAction type="submit" disabled={zustand.art === "sendet"}>
        {zustand.art === "sendet" ? "Wird angemeldet …" : "Anmelden"}
      </PrimaryAction>
    </form>
  );
}
