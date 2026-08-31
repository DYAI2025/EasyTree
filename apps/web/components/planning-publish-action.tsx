"use client";

/**
 * Die eine Publish-Aktion der Planungsansicht (EYT-107).
 *
 * ## Keine optimistische Scheinveroeffentlichung
 *
 * Diese Komponente setzt NIE selbst einen Zustand „veroeffentlicht". Sie
 * reicht die Serverantwort nach oben; die Woche wird neu gelesen, und was
 * danach dasteht, ist der Serverstand. Der Grund ist nicht Sauberkeit,
 * sondern Betrieb: eine Planerin, die „Veroeffentlicht" sieht, waehrend die
 * Transaktion zurueckgerollt ist, plant auf einem Zustand, den PostgreSQL
 * nicht kennt — und EYT-109 rechnete spaeter Kosten darauf.
 *
 * ## Warum auf `problem.type` verzweigt wird und nicht auf `failure`
 *
 * `HttpPlanningGateway.publishPlan` bildet JEDEN 409 auf `STALE_VERSION` ab
 * (`conflictAs`). Vier fachlich verschiedene Ablehnungen — veralteter Stand,
 * bereits veroeffentlicht, blockierender Konflikt, Zuweisung in fremder
 * Woche — kommen also mit demselben `failure` an. Wer hier nur `failure`
 * liest, zeigt allen vieren denselben Text.
 *
 * ## Basisdesign v2.0
 *
 * Ein primaerer CTA (`PrimaryAction`), Status nie nur ueber Farbe
 * (`StatusBadge` traegt eine Textmarke), Stale als neutrale Leiste mit dem
 * dort vorgegebenen Wortlaut „Plan wurde geändert — neu laden".
 */
import type { GatewayResult, PublishPlanCommand, PublishedPlanVersion } from "@easytree/contracts";
import { newIdempotencyKey, type IdempotencyKey } from "@easytree/contracts";
import { PrimaryAction, StateBanner, StatusBadge } from "@easytree/ui";
import { useCallback, useRef, useState } from "react";

/** Die Publish-Faehigkeit des Gateways, ohne den ganzen Port zu verlangen. */
export type PublishPlanFn = (
  input: PublishPlanCommand,
  options: { idempotencyKey: IdempotencyKey },
) => Promise<GatewayResult<PublishedPlanVersion>>;

export interface PlanningPublishActionProps {
  readonly weekKey: string;
  /** Der Stand, den der SERVER geliefert hat. `null` = keine Version. */
  readonly sourceVersion: { readonly id: string; readonly state: "draft" | "published" } | null;
  /** Aus der Sitzung: traegt die Rolle `planning.publish`? */
  readonly darfVeroeffentlichen: boolean;
  readonly publishPlan: PublishPlanFn;
  /**
   * Der Server hat entschieden. `PublishedPlanVersion` bei Erfolg, `null`
   * wenn nur neu gelesen werden soll (veralteter oder bereits
   * veroeffentlichter Stand).
   */
  readonly onVeroeffentlicht: (version: PublishedPlanVersion | null) => void;
}

type Ablehnung =
  | "stale-version"
  | "already-published"
  | "blocking-conflict"
  | "assignment-outside-week"
  | "idempotency-key-reused"
  | "unbekannt";

/**
 * Text je Ablehnung — vollstaendig ausgeschrieben, kein Standardzweig ausser
 * dem ausdruecklich benannten `unbekannt`.
 *
 * Die Texte sind fuer eine PLANERIN geschrieben. Jeder sagt, was NICHT
 * passiert ist und was sie jetzt tun kann.
 */
const ABLEHNUNG_TEXT: Record<Ablehnung, { titel: string; hinweis: string }> = {
  "stale-version": {
    // Wortlaut aus Basisdesign v2.0 §3.1, Zustand „Veraltet".
    titel: "Plan wurde geändert — neu laden",
    hinweis:
      "Seit dem Öffnen dieser Woche hat jemand anders den Entwurf verändert. Es wurde nichts veröffentlicht. Die Woche wird neu geladen.",
  },
  "already-published": {
    titel: "Diese Woche ist bereits veröffentlicht",
    hinweis:
      "Für diese Woche gibt es keinen offenen Entwurf mehr. Es wurde nichts erneut veröffentlicht. Die Woche wird neu geladen.",
  },
  "blocking-conflict": {
    titel: "Konflikt — nicht veröffentlicht",
    hinweis:
      "Der Entwurf enthält mindestens einen blockierenden Konflikt. Er wurde NICHT veröffentlicht; bitte den Konflikt auflösen und erneut versuchen.",
  },
  "assignment-outside-week": {
    titel: "Einsatz gehört nicht in diese Woche",
    hinweis:
      "Mindestens ein Einsatz dieses Entwurfs liegt in einer anderen Kalenderwoche. Es wurde nichts veröffentlicht.",
  },
  "idempotency-key-reused": {
    titel: "Vorgang nicht eindeutig",
    hinweis:
      "Dieser Veröffentlichungsvorgang wurde bereits mit anderen Daten verwendet. Bitte die Seite neu laden und erneut versuchen.",
  },
  unbekannt: {
    titel: "Nicht veröffentlicht",
    hinweis:
      "Die Veröffentlichung konnte nicht abgeschlossen werden. Es wurde nichts veröffentlicht.",
  },
};

const URN_PRAEFIX = "urn:easytree:planning:";

/** `type` -> bekannte Ablehnung. Alles andere ist ausdruecklich `unbekannt`. */
function ablehnungAus(typ: string | undefined): Ablehnung {
  if (typ === undefined || !typ.startsWith(URN_PRAEFIX)) return "unbekannt";
  const rest = typ.slice(URN_PRAEFIX.length);
  return rest === "stale-version" ||
    rest === "already-published" ||
    rest === "blocking-conflict" ||
    rest === "assignment-outside-week" ||
    rest === "idempotency-key-reused"
    ? rest
    : "unbekannt";
}

/** Nach welchen Ablehnungen ist der angezeigte Stand ueberholt? */
const NEU_LADEN: ReadonlySet<Ablehnung> = new Set<Ablehnung>([
  "stale-version",
  "already-published",
]);

type Ablauf =
  | { readonly kind: "bereit" }
  | { readonly kind: "laeuft" }
  | { readonly kind: "erfolg"; readonly version: PublishedPlanVersion }
  | { readonly kind: "abgelehnt"; readonly ablehnung: Ablehnung; readonly detail: string | null };

export function PlanningPublishAction({
  weekKey,
  sourceVersion,
  darfVeroeffentlichen,
  publishPlan,
  onVeroeffentlicht,
}: PlanningPublishActionProps): React.ReactNode {
  const [ablauf, setAblauf] = useState<Ablauf>({ kind: "bereit" });

  /**
   * Ein Schluessel je VORGANG, nicht je Klick.
   *
   * Genau derselbe Gedanke wie beim Anlegen eines Einsatzes: geht die Antwort
   * verloren, weiss die Planerin nicht, ob veroeffentlicht wurde. Sie drueckt
   * erneut — und mit einem frischen Schluessel saehe der Server einen ZWEITEN
   * Vorgang. Der Schluessel bleibt deshalb an (Woche, erwartete Version)
   * gebunden und wird erst nach ERFOLG verworfen.
   */
  const vorgang = useRef<{ kennung: string; key: IdempotencyKey } | null>(null);

  const istEntwurf = sourceVersion !== null && sourceVersion.state === "draft";
  const stand: "draft" | "published" =
    sourceVersion?.state === "published" || ablauf.kind === "erfolg" ? "published" : "draft";

  const veroeffentlichen = useCallback(async () => {
    if (sourceVersion === null) return;
    const kennung = `${weekKey}|${sourceVersion.id}`;
    let aktuell = vorgang.current;
    if (aktuell === null || aktuell.kennung !== kennung) {
      aktuell = { kennung, key: newIdempotencyKey() };
      vorgang.current = aktuell;
    }

    setAblauf({ kind: "laeuft" });
    const ergebnis = await publishPlan(
      { weekKey, expectedVersionId: sourceVersion.id },
      { idempotencyKey: aktuell.key },
    );

    if (ergebnis.ok) {
      // Erst JETZT — nach der Serverantwort — wechselt die Darstellung. Der
      // Vorgang ist abgeschlossen, der Schluessel wird verworfen.
      vorgang.current = null;
      setAblauf({ kind: "erfolg", version: ergebnis.value });
      onVeroeffentlicht(ergebnis.value);
      return;
    }

    const ablehnung = ablehnungAus(ergebnis.problem?.type);
    setAblauf({ kind: "abgelehnt", ablehnung, detail: ergebnis.problem?.detail ?? null });
    if (NEU_LADEN.has(ablehnung)) {
      // Der angezeigte Stand ist ueberholt. Neu lesen, aber ohne eine
      // veroeffentlichte Version zu behaupten.
      onVeroeffentlicht(null);
    }
  }, [onVeroeffentlicht, publishPlan, sourceVersion, weekKey]);

  return (
    <div className="eyt-planung-publish">
      {/*
        Ohne Version gibt es keinen Stand, den diese Marke benennen koennte —
        eine „Entwurf"-Marke ueber einer versionslosen Woche waere erfundene
        Information (EYT-147; die Wochenansicht sagt dort „Keine Version").
        Nach einem Erfolg bleibt sie stehen, auch wenn der Elternteil den
        Serverstand noch nachlaedt.
      */}
      {sourceVersion !== null || ablauf.kind === "erfolg" ? (
        <p data-testid="planung-stand-marke">
          <StatusBadge tone={stand}>
            {stand === "published" ? "Veröffentlicht" : "Entwurf"}
          </StatusBadge>
        </p>
      ) : null}

      {/*
        Die Ehrlichkeitsgrenze steht NEBEN der Aktion, nicht in einem Runbook,
        das niemand oeffnet: beim Veroeffentlichen werden Abwesenheiten,
        Qualifikationen, Zertifikate, Ressourcen, Fahrzeuge und Geraete NICHT
        geprueft. Fuer sie existiert im Produktivcode keine Regel (EYT-18).
      */}
      {istEntwurf && darfVeroeffentlichen ? (
        <p data-testid="planung-publish-grenze" className="eyt-planung-publish__grenze">
          Geprüft werden Überschneidungen derselben Person und die Zuordnung zur Woche. Noch
          <strong> nicht</strong> geprüft: Abwesenheiten, Qualifikationen, Zertifikate, Ressourcen,
          Fahrzeuge und Geräte.
        </p>
      ) : null}

      {ablauf.kind === "erfolg" ? (
        <StateBanner
          tone="success"
          title="Veröffentlicht"
          data-testid="planung-publish-erfolg"
          data-published-version-id={ablauf.version.versionId}
        >
          Planversion {ablauf.version.versionId} ist seit {ablauf.version.publishedAtUtc}{" "}
          verbindlich. Sie kann nicht mehr verändert werden.
        </StateBanner>
      ) : null}

      {ablauf.kind === "abgelehnt" ? (
        <StateBanner
          tone={ablauf.ablehnung === "stale-version" ? "warning" : "danger"}
          title={ABLEHNUNG_TEXT[ablauf.ablehnung].titel}
          data-testid="planung-publish-fehler"
          data-problem={ablauf.ablehnung}
        >
          {ABLEHNUNG_TEXT[ablauf.ablehnung].hinweis}
          {ablauf.detail === null ? null : ` ${ablauf.detail}`}
        </StateBanner>
      ) : null}

      {istEntwurf && darfVeroeffentlichen ? (
        <PrimaryAction
          data-testid="planung-veroeffentlichen"
          disabled={ablauf.kind === "laeuft"}
          onClick={() => {
            void veroeffentlichen();
          }}
        >
          {ablauf.kind === "laeuft" ? "Plan wird veröffentlicht …" : "Plan veröffentlichen"}
        </PrimaryAction>
      ) : null}
    </div>
  );
}
