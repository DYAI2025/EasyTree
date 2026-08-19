"use client";

import Link from "next/link";

import { Card } from "@easytree/ui";

/**
 * Der Kostenuebergang aus der Planungsflaeche heraus (EYT-140, `REQ-006`,
 * `AC-010`).
 *
 * Meilensteinnummer: im Plan ist das **M8** (`:714`). Der Commit `036a5b3` nennt
 * ihn „M6"; unter M6 fuehrt der Plan aber den Werkbankrahmen
 * (`planungs-werkbank.tsx`, `:619`), der unerledigt ist. Hier steht die
 * Plannummer, damit „M6 erledigt" nicht als Werkbankrahmen gelesen wird.
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
 * Diese Komponente liest die Sitzung NICHT — die Begruendung steht an EINER
 * Stelle, im Dateikopf von `planung-zugang.tsx`. Sie stand bis zum 19.08.2026
 * hier, dort und in `planung-ansicht.tsx` in nahezu gleicher Laenge; drei
 * Fassungen desselben Arguments driften auseinander, sobald eine von ihnen
 * angefasst wird. Gemessen wird die Regel von
 * `apps/web/test/kosten-uebergang.test.tsx` („der Uebergang stellt die
 * Rechtefrage nicht selbst"), nicht von diesem Absatz.
 *
 * Sichtbarkeit ersetzt keine Autorisierung: entschieden wird in
 * `cost-access.policy.ts`, und `app.has_permission` entscheidet unabhaengig
 * davon noch einmal.
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
 *
 * Bis zum 19.08.2026 endete dieser Satz mit „— ein Entwurf traegt noch keine".
 * Der Halbsatz las sich als Aussage ueber DIESE Woche und blieb nach einem
 * erfolgreichen Publish unveraendert stehen — also ausgerechnet dann falsch,
 * wenn die Planerin ihn am ehesten liest. Die Alternative waere gewesen, den
 * veroeffentlichten Stand hier hereinzureichen; das haette aus dem Uebergang
 * eine zweite Anzeigebedingung gemacht, die kein Dokument verlangt (siehe
 * Absatz darueber). Gewaehlt ist deshalb die Formulierung, die in beiden
 * Staenden dasselbe behauptet: eine Aussage ueber die HERKUNFT der Kosten,
 * keine ueber den Stand der Woche.
 */
export function KostenUebergang({ weekKey }: { weekKey: string }) {
  return (
    // Die Testid auf der Karte umfasst Text UND Verweis. Ohne sie liesse sich
    // der Wochenbezug nur dokumentweit pruefen — der Wochenschluessel steht
    // aber auch in der Wochennavigation, eine dokumentweite Zusicherung waere
    // also selbst dann gruen, wenn dieser Text eine feste Woche naeme.
    // Gemessen wird der Bezug in `apps/web/test/kosten-uebergang.test.tsx`
    // („nennt die Woche aus der Adresse").
    <Card title="Kosten" data-testid="werkbank-kostenuebergang-karte">
      <p>
        Die Personalkosten der Woche {weekKey} entstehen aus der veröffentlichten Planversion, nicht
        aus dem Entwurf.
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
