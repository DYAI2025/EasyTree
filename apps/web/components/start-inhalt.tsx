import { Button, Card } from "@easytree/ui";

import { ApiStatus } from "./api-status";

/**
 * Inhalt der Werkbank-Startseite — bewusst eine synchrone Komponente ohne
 * Serverbezug: `app/(werkbank)/page.tsx` entscheidet davor serverseitig
 * ueber die Start-Shell (EYT-113), und `test/a11y.test.tsx` rendert diesen
 * Inhalt direkt in jsdom, wo ein async Server Component nicht laufen kann.
 */
export function StartInhalt() {
  return (
    <>
      <h1>Willkommen bei easyTree</h1>
      <p className="lead">
        Die mobile-first Web-Shell für easyTree. Fachliche Inhalte folgen in den nächsten Sprints —
        diese Seite ist der barrierefreie Rahmen (EYT-41).
      </p>
      <div className="card-grid">
        <Card id="status" title="Plattformstatus">
          <ApiStatus />
          <p>Die Shell spricht die API ausschließlich über den injizierten ApiClient an.</p>
        </Card>
        <Card title="Installierbar (PWA)">
          <p>
            easyTree lässt sich als App installieren (Manifest, display standalone). Eine
            Offline-Schreibqueue gibt es bewusst nicht — gearbeitet wird online.
          </p>
          <Button variant="ghost">Mehr erfahren</Button>
        </Card>
      </div>
    </>
  );
}
