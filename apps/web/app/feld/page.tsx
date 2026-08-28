import { PageHeader } from "@easytree/ui";

import { FeldStart } from "../../components/feld/feld-start";

/**
 * Startseite der Feld-App (EYT-113). Muster wie die Werkbank-Seiten:
 * Fragment, KEIN eigenes `<main>` — die Landmark stellt die Feld-Shell.
 */
export default function FeldPage() {
  return (
    <>
      <PageHeader
        title="Feld"
        description="Dein Einstieg für den Einsatz — angemeldet mit deinem easyTree-Konto."
      />
      <FeldStart />
    </>
  );
}
