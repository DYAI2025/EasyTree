import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ErrorState } from "@easytree/ui";

import { FeldShell } from "../../components/feld/feld-shell";
import { leseServerSitzung } from "../../lib/feld/sitzung-server";

export const metadata: Metadata = { title: "Feld — easyTree" };

/**
 * Server-Gate der Feld-Shell (EYT-113): die zulaessige Shell folgt aus der
 * REAL VERIFIZIERTEN Session — die API prueft die Cookies, nicht diese
 * Datei, und nicht die Route. `headers()` macht den Teilbaum dynamisch;
 * das Proxyziel wird damit nie zur Bauzeit gelesen (EYT-126).
 *
 * Fail-closed in beide Richtungen: Abgemeldete werden zur Anmeldung
 * geleitet, und NICHTWISSEN (API nicht erreichbar, Antwort unlesbar) ist
 * nicht abgemeldet — es zeigt eine ehrliche Fehlerflaeche statt Shell.
 */
export default async function FeldLayout({ children }: { children: ReactNode }) {
  const kopfzeilen = await headers();
  const sitzung = await leseServerSitzung(kopfzeilen.get("cookie"));

  if (sitzung.zustand === "abgemeldet") {
    redirect("/anmelden");
  }

  if (sitzung.zustand === "unbekannt") {
    return (
      <main id="hauptinhalt" tabIndex={-1} className="eyt-app-shell__main feld-gate">
        <ErrorState
          data-testid="feld-sitzung-unbekannt"
          title="Anmeldung nicht prüfbar"
          description="Die Anmeldung konnte serverseitig nicht geprüft werden. Bitte versuche es später erneut."
        />
      </main>
    );
  }

  return <FeldShell>{children}</FeldShell>;
}
