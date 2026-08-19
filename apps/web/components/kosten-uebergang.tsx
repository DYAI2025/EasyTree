"use client";

import Link from "next/link";

import { Card } from "@easytree/ui";

/**
 * Der Kostenuebergang aus der Planungsflaeche heraus (EYT-140 M6, `REQ-006`,
 * `AC-010`).
 *
 * ## Was hier NICHT entsteht
 *
 * Keine Kostenfaehigkeit. Die existiert vollstaendig — `/kosten`,
 * `KostenZugang`, `KostenAnsicht`, `CostsGateway`, der EYT-109-Snapshot und die
 * Serverpolicy (`db-gates` · `[cost-access]`). Was fehlte, war ausschliesslich
 * der WEG dorthin: `docs/traceability.md`, S6 Tabelle D nennt fuer `REQ-006`
 * woertlich „den Übergang aus der Planung heraus bedienbar machen". Bis hierher
 * musste die Planerin die Adresse kennen oder ueber die Kopfleiste zurueck an
 * den Anfang. Diese Datei ist deshalb ein Link und sonst nichts: kein
 * Gateway-Aufruf, keine Berechnung, kein Betrag.
 *
 * ## Warum hier keine Rechtefrage gestellt wird
 *
 * Diese Komponente liest die Sitzung NICHT. Ob sie ueberhaupt entsteht,
 * entscheidet `PlanungZugang` — derselbe Waechter, der schon
 * `darfVeroeffentlichen` beantwortet, aus derselben einen Sitzungsquelle
 * (`useSession` ueber `GET /auth/session`). Ein eigener `useSession`-Aufruf
 * waere eine zweite Stelle, an der dieselbe Frage anders beantwortet werden
 * koennte; genau das haelt der Dateikopf von `planung-zugang.tsx` seit EYT-107
 * fest, und `PlanningWindowView` folgt derselben Regel.
 *
 * Sichtbarkeit ersetzt keine Autorisierung: `costs.read` steuert hier
 * ausschliesslich die Anzeige. Entschieden wird serverseitig in
 * `cost-access.policy.ts`, und `app.has_permission` entscheidet noch einmal
 * unabhaengig davon.
 *
 * ## Warum das kein Leck nach `AC-011` ist
 *
 * `AC-011` verlangt, dass ohne `costs.read` weder Betraege noch der
 * Kostenverweis in der SERVERANTWORT stehen — RSC-Flight-Payload eingeschlossen,
 * weil Props einer Client-Komponente dort landen, auch wenn ein Waechter sie
 * nie rendert. Der Uebergang entsteht aus Sitzungsdaten, die der Client zur
 * Laufzeit holt, nicht aus einer Server-Prop: `app/planung/page.tsx` reicht nur
 * `weekKey` ueber die Grenze, und `weekKey` steht ohnehin in der Adresse. Es
 * gibt also nichts, was ueber diesen Weg in den Payload gelangen koennte.
 *
 * ## Warum der Uebergang nicht am veroeffentlichten Stand haengt
 *
 * `REQ-006` nennt genau eine Bedingung: „Nur Nutzer mit `costs.read` erhalten
 * einen verstaendlichen Übergang zu `/kosten`." Der Meilenstein im Plan sagt
 * dasselbe („ausschliesslich mit `costs.read` aus der realen Session"). Das
 * „Given ein veroeffentlichter Plan" aus `AC-010` beschreibt die abgenommene
 * Reise, nicht eine zweite Anzeigebedingung — sie hier zu erfinden, waere ein
 * Verhalten, das kein Dokument verlangt. Der Bezug zur Woche steht deshalb im
 * TEXT, und der Text bleibt in beiden Staenden wahr: Kosten entstehen aus der
 * veroeffentlichten Planversion, nicht aus dem Entwurf.
 */
export function KostenUebergang({ weekKey }: { weekKey: string }) {
  return (
    <Card title="Kosten">
      <p>
        Die Personalkosten der Woche {weekKey} entstehen aus der veröffentlichten Planversion — ein
        Entwurf trägt noch keine.
      </p>
      <p>
        {/*
          Ziel ist die Kostenfläche selbst, ohne technischen Parameter: `/kosten`
          kennt genau einen (`?snapshot=<id>`), und den vergibt der Server. Eine
          Wochen- oder Datumsangabe an dieser Stelle wäre eine erfundene
          Schnittstelle.
        */}
        <Link data-testid="werkbank-kostenuebergang" href="/kosten">
          Kosten dieser Woche ansehen
        </Link>
      </p>
    </Card>
  );
}
