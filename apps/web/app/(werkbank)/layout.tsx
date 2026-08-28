import type { ReactNode } from "react";

import { AppShell } from "../../components/app-shell";

/**
 * Werkbank-Layout (EYT-113): die bestehende Admin-/Werkbank-Shell gilt nur
 * noch für die Routen dieser Route Group. Die Route Group ändert keine URLs,
 * sie zieht die Shell-Grenze — die Feld-Shell unter `app/feld/` hat ein
 * eigenes Layout und eine eigene Navigation.
 */
export default function WerkbankLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
