import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { StartInhalt } from "../../components/start-inhalt";
import { leseServerSitzung } from "../../lib/sitzung-server";
import { startShellFuer } from "../../lib/feld/start-shell";

/**
 * Werkbank-Startseite mit Start-Shell-Dispatch (EYT-113): die zulaessige
 * Start-Shell folgt SERVERSEITIG aus der real verifizierten Session. Wer
 * ausschliesslich als member arbeitet, gehoert ins Feld und wird dorthin
 * geleitet — die Route selbst verleiht kein Recht, sie liest nur.
 *
 * Abgemeldete und NICHT PRUEFBARE Sitzungen sehen die Startseite unveraendert:
 * sie ist oeffentlich, und Nichtwissen darf niemanden aussperren oder
 * umleiten (fail-open ist hier richtig, weil kein Inhalt geschuetzt ist —
 * geschuetzte Inhalte pruefen API und RLS).
 */
export default async function HomePage() {
  const kopfzeilen = await headers();
  const sitzung = await leseServerSitzung(kopfzeilen.get("cookie"));
  if (sitzung.zustand === "angemeldet" && startShellFuer(sitzung.session) === "feld") {
    redirect("/feld");
  }
  return <StartInhalt />;
}
