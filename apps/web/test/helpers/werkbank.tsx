/**
 * Die zusammengesetzte Planungswerkbank fuer die Slice-1-Abnahmetests (EYT-140).
 *
 * ## Was hier ECHT ist — und was nicht
 *
 * Echt sind: die Kompositionswurzel `app/providers.tsx`, die Shell
 * `components/app-shell.tsx`, die Seite `app/planung/page.tsx`, der
 * Sitzungsprovider, die Zugangswaechter, die vertragsabgeleiteten Gateways
 * (`HttpPlanningGateway`, `HttpAuthGateway`, `HttpCostsGateway`) samt
 * Zod-Pruefung jeder Antwort und die Gateway-Fabriken, die auch die URL bauen.
 *
 * Ersetzt ist ausschliesslich `globalThis.fetch` — die HTTP-Grenze. Das ist die
 * tiefste Grenze, die in jsdom ueberhaupt erreichbar ist: API und PostgreSQL
 * laufen hier nicht. Genau deshalb behauptet keine Zusicherung dieser Tests,
 * der SERVERPFAD sei bewiesen. Der wird von den CI-Jobs `read-through`
 * (`scripts/read-through-harness.sh`) und `auth-journey` bewiesen, gegen echte
 * API, echtes GoTrue und echtes PostgreSQL mit RLS. Was hier bewiesen wird, ist
 * die andere Haelfte, die dort NICHT geprueft wird: dass die bestehenden
 * Faehigkeiten in der neuen Werkbank-Reise ERREICHBAR sind und dass die
 * Oberflaeche ausschliesslich das anzeigt, was ueber diese Grenze hereinkam.
 *
 * ## Warum kein Gateway-Doppel
 *
 * Ein Test, der `PlanningGateway` durch ein Objektliteral ersetzt, misst seine
 * eigene Attrappe: Vertragspruefung, Statusabbildung (401 → UNAUTHENTICATED,
 * 409 → STALE_VERSION), Idempotenzheader und Basis-URL fallen alle weg. Die
 * bestehenden Komponententests tun das bewusst und pruefen damit Zustaende
 * einzelner Komponenten. Diese Datei prueft die REISE — dafuer muss dazwischen
 * echter Produktionscode liegen.
 */
import type {
  AssignmentDto,
  CreateAssignmentCommand,
  PlanningWindow,
  PublishPlanCommand,
  PublishedPlanVersion,
  SessionDto,
} from "@easytree/contracts";
import { render } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";

import PlanungPage from "../../app/(werkbank)/planung/page";
import { Providers } from "../../app/providers";
import { AppShell } from "../../components/app-shell";
import { navigation, navigieren } from "./navigation-attrappe";

/** Eine rohe HTTP-Antwort, wenn der Erfolgsfall nicht gemeint ist. */
export interface RoheAntwort {
  readonly __antwort: true;
  readonly status: number;
  readonly koerper: unknown;
}

export function antwort(status: number, koerper: unknown = {}): RoheAntwort {
  return { __antwort: true, status, koerper };
}

function istRoheAntwort(wert: unknown): wert is RoheAntwort {
  return typeof wert === "object" && wert !== null && "__antwort" in wert;
}

export interface NetzAufruf {
  readonly methode: string;
  /** Pfad ohne Suchteil, z. B. `/api/v1/planung/fenster`. */
  readonly pfad: string;
  /** Vollstaendige URL, wie der Produktionscode sie gebaut hat. */
  readonly url: string;
  readonly suche: URLSearchParams;
  readonly koerper: unknown;
  readonly kopf: Record<string, string>;
}

export interface NetzPlan {
  /** Antwort auf `GET /auth/session`. */
  readonly sitzung: SessionDto | RoheAntwort;
  /** Antwort auf `GET /planung/fenster?weekKey=…`, je Woche. */
  readonly fenster: (weekKey: string) => PlanningWindow | RoheAntwort;
  readonly einsatzAnlegen?: (befehl: CreateAssignmentCommand) => AssignmentDto | RoheAntwort;
  readonly veroeffentlichen?: (befehl: PublishPlanCommand) => PublishedPlanVersion | RoheAntwort;
}

export interface Netzprotokoll {
  readonly aufrufe: readonly NetzAufruf[];
  /** Die Wochen, nach denen tatsaechlich gefragt wurde, in Reihenfolge. */
  gefragteWochen(): string[];
  aufrufeAn(pfad: string): NetzAufruf[];
}

const ECHTES_FETCH = globalThis.fetch;

function alsResponse(status: number, koerper: unknown): Response {
  // Die Gateways lesen ausschliesslich `ok`, `status` und `json()`. Ein echtes
  // `Response` waere hier eine Umgebungsabhaengigkeit ohne Gegenwert.
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => koerper,
  } as unknown as Response;
}

function kopfAls(init: RequestInit | undefined): Record<string, string> {
  const roh = init?.headers;
  if (roh === undefined) return {};
  if (Array.isArray(roh)) return Object.fromEntries(roh);
  if (roh instanceof Headers) return Object.fromEntries(roh.entries());
  return { ...(roh as Record<string, string>) };
}

/**
 * Setzt die HTTP-Grenze und protokolliert jeden Aufruf.
 *
 * Ein unbekannter Pfad wird NICHT stillschweigend beantwortet: er landet mit
 * 404 im Protokoll, damit ein Test „es ging kein Kostenaufruf raus" belegen
 * kann, statt es zu hoffen.
 */
export function netzSetzen(plan: NetzPlan): Netzprotokoll {
  const aufrufe: NetzAufruf[] = [];

  globalThis.fetch = (async (eingabe: unknown, init?: RequestInit): Promise<Response> => {
    const rohUrl = String(eingabe);
    const url = new URL(rohUrl, "http://werkbank.test");
    const koerper: unknown =
      typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    aufrufe.push({
      methode: (init?.method ?? "GET").toUpperCase(),
      pfad: url.pathname,
      url: rohUrl,
      suche: url.searchParams,
      koerper,
      kopf: kopfAls(init),
    });

    const methode = (init?.method ?? "GET").toUpperCase();

    if (url.pathname === "/api/v1/auth/session" && methode === "GET") {
      return istRoheAntwort(plan.sitzung)
        ? alsResponse(plan.sitzung.status, plan.sitzung.koerper)
        : alsResponse(200, plan.sitzung);
    }

    if (url.pathname === "/api/v1/planung/fenster" && methode === "GET") {
      const ergebnis = plan.fenster(url.searchParams.get("weekKey") ?? "");
      return istRoheAntwort(ergebnis)
        ? alsResponse(ergebnis.status, ergebnis.koerper)
        : alsResponse(200, ergebnis);
    }

    if (url.pathname === "/api/v1/planung/einsaetze" && methode === "POST") {
      const ergebnis = plan.einsatzAnlegen?.(koerper as CreateAssignmentCommand);
      if (ergebnis === undefined) return alsResponse(501, {});
      return istRoheAntwort(ergebnis)
        ? alsResponse(ergebnis.status, ergebnis.koerper)
        : alsResponse(201, ergebnis);
    }

    if (url.pathname === "/api/v1/planung/versionen" && methode === "POST") {
      const ergebnis = plan.veroeffentlichen?.(koerper as PublishPlanCommand);
      if (ergebnis === undefined) return alsResponse(501, {});
      return istRoheAntwort(ergebnis)
        ? alsResponse(ergebnis.status, ergebnis.koerper)
        : alsResponse(201, ergebnis);
    }

    return alsResponse(404, {
      type: "about:blank",
      title: "Im Werkbanktest nicht verdrahtet",
      status: 404,
      detail: `${methode} ${url.pathname}`,
      correlationId: "test",
    });
  }) as typeof fetch;

  return {
    aufrufe,
    gefragteWochen: () =>
      aufrufe
        .filter((a) => a.pfad === "/api/v1/planung/fenster")
        .map((a) => a.suche.get("weekKey") ?? ""),
    aufrufeAn: (pfad: string) => aufrufe.filter((a) => a.pfad === pfad),
  };
}

export function netzLoesen(): void {
  globalThis.fetch = ECHTES_FETCH;
}

function paramsAus(suche: string): Record<string, string | string[] | undefined> {
  const params = new URLSearchParams(suche);
  const ergebnis: Record<string, string | string[] | undefined> = {};
  for (const schluessel of new Set(params.keys())) {
    const werte = params.getAll(schluessel);
    ergebnis[schluessel] = werte.length > 1 ? werte : werte[0];
  }
  return ergebnis;
}

/**
 * Nachbildung dessen, was der App Router tut: Adresse aendert sich, die
 * Serverkomponente laeuft mit den neuen `searchParams` erneut.
 *
 * Damit ist der Test gegenueber der Umsetzung neutral. Wechselt die Woche ueber
 * `router.push`, ueber einen `<Link>` oder rein im Clientzustand — beobachtbar
 * ist in allen drei Faellen dasselbe.
 */
function NextNachbildung({ anfangsSuche }: { anfangsSuche: string }): ReactNode {
  const [suche, setSuche] = useState(anfangsSuche);
  const [inhalt, setInhalt] = useState<ReactNode>(null);

  useEffect(() => {
    navigation.aufNavigation = (ziel) => {
      const ziehl = new URL(ziel, "http://werkbank.test");
      if (ziehl.pathname !== "/planung") return;
      setSuche(ziehl.search);
    };
    return () => {
      navigation.aufNavigation = null;
    };
  }, []);

  useEffect(() => {
    let abgebrochen = false;
    navigation.suche = suche;
    void PlanungPage({ searchParams: Promise.resolve(paramsAus(suche)) }).then((element) => {
      if (!abgebrochen) setInhalt(element);
    });
    return () => {
      abgebrochen = true;
    };
  }, [suche]);

  return (
    <div
      onClickCapture={(ereignis) => {
        // Auch ein `<Link>` ist eine gueltige Umsetzung der Wochennavigation.
        // jsdom navigiert nicht von selbst, also uebernimmt das hier die
        // Nachbildung — und zwar VOR Nexts eigenem Klickbehandler, damit der
        // sich am unterbundenen Standardverhalten orientiert.
        const anker = (ereignis.target as HTMLElement).closest("a");
        if (anker === null) return;
        const href = anker.getAttribute("href");
        if (href === null || !href.startsWith("/")) return;
        ereignis.preventDefault();
        navigieren(href);
      }}
    >
      {inhalt}
    </div>
  );
}

/**
 * Rendert die Werkbank so, wie die Anwendung sie zusammensetzt.
 *
 * `anfangsSuche` ist der Suchteil der Adresse. Leer heisst: die Planerin ruft
 * `/planung` OHNE technischen Parameter auf — der Normalfall der Reise.
 */
export function werkbankRendern(plan: NetzPlan, anfangsSuche = ""): Netzprotokoll {
  const protokoll = netzSetzen(plan);
  navigation.suche = anfangsSuche;
  render(
    <Providers>
      <AppShell>
        <NextNachbildung anfangsSuche={anfangsSuche} />
      </AppShell>
    </Providers>,
  );
  return protokoll;
}
