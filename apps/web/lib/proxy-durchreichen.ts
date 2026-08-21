/**
 * Same-Origin-Durchreiche zur API (EYT-50, laufzeitfaehig seit EYT-126).
 *
 * ## Warum Route Handler und nicht `rewrites()`
 *
 * `next.config.ts`-`rewrites()` werden beim BAUEN aufgeloest und landen in
 * `.next/routes-manifest.json`. Ein fertiges Image liesse sich damit nicht mehr
 * auf ein anderes Ziel schalten — Confluence 30998530 verlangt aber dieselben
 * Images fuer Coolify/VPS und Railway.
 *
 * ## Warum auch keine `proxy.ts` (Node-Middleware)
 *
 * Zwei Messungen vom 21.08.2026 sprechen dagegen:
 *
 *   1. `NextResponse.rewrite()` auf ein externes Ziel sendet den Kopf
 *      `x-middleware-rewrite: <interne Adresse>` an den Browser. Er laesst sich
 *      nicht entfernen, ohne die Weiterleitung selbst abzuschalten — er IST der
 *      Mechanismus.
 *   2. `@opennextjs/cloudflare` bricht mit "Node.js middleware is not currently
 *      supported" ab. Dieser Bau laeuft im Pflichtjob `build-web`.
 *
 * Ein Route Handler hat beide Probleme nicht: er baut die Antwort selbst, also
 * bestimmt er jeden Kopf, und er ist gewoehnlicher Servercode.
 *
 * ## Der Browser sieht die Adresse nie
 *
 * Die Variable traegt bewusst KEIN `NEXT_PUBLIC_`-Praefix. Sie wird nur hier
 * gelesen, im Serverprozess. Drei Lecks werden aktiv geschlossen, nicht nur
 * eines:
 *
 *   * kein `x-middleware-rewrite` — es entsteht gar nicht erst;
 *   * `location` auf das interne Ziel wird in einen relativen Pfad uebersetzt
 *     (Pfad, Query und Fragment bleiben erhalten). Ohne diesen Schritt truege
 *     der Browser die interne Adresse in die Adresszeile und riefe sie als
 *     naechstes selbst auf. Ein FREMDES Weiterleitungsziel bleibt unangetastet;
 *   * ein Verbindungsfehler wird zu einem eigenen 502, statt die Fehlermeldung
 *     von undici (sie nennt den Host) durch Nexts Fehlerseite laufen zu lassen.
 */
import { normalizeProxyTarget } from "./api-proxy-target";

/**
 * Koepfe, die nur fuer EINE Verbindung gelten. Weitergereicht wuerden sie den
 * naechsten Hop belügen — `transfer-encoding` und `content-length` beschreiben
 * eine Rahmung, die hier neu entsteht.
 */
const VERBINDUNGSKOEPFE = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Das Ziel, JETZT. Bewusst eine Funktion und keine Modulkonstante: eine
 * Konstante wuerde beim Laden des Moduls eingefroren, und genau das ist der
 * Fehler, den dieser Slice behebt.
 */
export function aktuellesProxyziel(): string {
  return normalizeProxyTarget(process.env.EASYTREE_API_PROXY_TARGET, process.env.NODE_ENV);
}

/**
 * Uebersetzt einen `location`-Kopf so, dass die interne Adresse den Browser
 * nicht erreicht.
 *
 * Drei Faelle, und nur der erste wird angefasst:
 *
 *   1. absolut UND auf dem internen Ziel  -> Origin (und Basispfad) abstreifen;
 *   2. absolut auf einem fremden Host     -> unveraendert; eine fremde
 *      Weiterleitung spekulativ umzuschreiben waere schlimmer als das Leck,
 *      das sie nicht ist;
 *   3. bereits relativ                    -> unveraendert; der Browser loest
 *      sie ohnehin gegen die Web-Origin auf, was genau richtig ist.
 */
export function uebersetzeWeiterleitung(roh: string, ziel: string): string {
  let ort: URL;
  try {
    ort = new URL(roh);
  } catch {
    return roh;
  }

  const zielUrl = new URL(ziel);
  if (ort.origin !== zielUrl.origin) return roh;

  // Der Basispfad ist der Anteil, den `durchreichen` beim Hinweg VORNE
  // angehaengt hat; der Rueckweg muss ihn abziehen, sonst zeigt der relative
  // Pfad auf eine Route, die es in der Web-App nicht gibt.
  const basis = zielUrl.pathname.replace(/\/+$/, "");
  const imBasispfad =
    basis !== "" && (ort.pathname === basis || ort.pathname.startsWith(`${basis}/`));
  const pfad = imBasispfad ? ort.pathname.slice(basis.length) || "/" : ort.pathname;

  return `${pfad}${ort.search}${ort.hash}`;
}

export async function durchreichen(request: Request): Promise<Response> {
  const ziel = aktuellesProxyziel();
  const eingang = new URL(request.url);
  const url = new URL(`${ziel}${eingang.pathname}${eingang.search}`);

  const anfrageKopf = new Headers(request.headers);
  for (const name of VERBINDUNGSKOEPFE) anfrageKopf.delete(name);
  anfrageKopf.delete("host");
  anfrageKopf.delete("content-length");
  // Ohne diese Zeile antwortet die API komprimiert, `fetch` entpackt still, und
  // ein weitergereichtes `content-encoding: gzip` beschriebe einen Koerper, den
  // es so nicht mehr gibt.
  anfrageKopf.delete("accept-encoding");

  const hatKoerper = request.method !== "GET" && request.method !== "HEAD";

  let oben: Response;
  try {
    oben = await fetch(url, {
      method: request.method,
      headers: anfrageKopf,
      body: hatKoerper ? request.body : undefined,
      // `manual`: eine Weiterleitung der API gehoert zum Browser, nicht zum Proxy.
      redirect: "manual",
      ...(hatKoerper ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    // Die Meldung von undici nennt den Zielhost ("ENOTFOUND api-intern"). Sie
    // weiterzuwerfen liesse sie durch Nexts Fehlerseite laufen; hier entsteht
    // stattdessen eine Antwort, die den Fehler benennt, ohne die Adresse.
    return new Response(
      JSON.stringify({
        title: "Die API ist nicht erreichbar.",
        status: 502,
        detail: "Der Same-Origin-Proxy konnte die API nicht erreichen.",
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  const antwortKopf = new Headers();
  for (const [name, wert] of oben.headers) {
    if (VERBINDUNGSKOEPFE.has(name)) continue;
    if (name === "content-encoding" || name === "content-length") continue;
    // `set-cookie` NICHT ueber set(): mehrere Koepfe wuerden zu einem
    // zusammengefaltet, und ein zusammengefaltetes Cookie-Paar ist kaputt.
    if (name === "set-cookie") continue;
    if (name === "location") {
      antwortKopf.set("location", uebersetzeWeiterleitung(wert, ziel));
      continue;
    }
    antwortKopf.set(name, wert);
  }
  for (const keks of oben.headers.getSetCookie()) antwortKopf.append("set-cookie", keks);

  return new Response(oben.body, {
    status: oben.status,
    statusText: oben.statusText,
    headers: antwortKopf,
  });
}
