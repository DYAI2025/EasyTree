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
 * gelesen, im Serverprozess. Vier Lecks werden aktiv geschlossen, nicht nur
 * eines:
 *
 *   * kein `x-middleware-rewrite` — es entsteht gar nicht erst;
 *   * `location` auf das interne Ziel wird in einen relativen Pfad uebersetzt
 *     (Pfad, Query und Fragment bleiben erhalten). Ohne diesen Schritt truege
 *     der Browser die interne Adresse in die Adresszeile und riefe sie als
 *     naechstes selbst auf. Ein FREMDES Weiterleitungsziel bleibt unangetastet;
 *   * JEDER uebrige Antwortkopf, dessen WERT die interne Adresse nennt, faellt
 *     weg — `X-Upstream-Url`, `Link: <…>; rel="self"`, `Content-Location`, ein
 *     `Set-Cookie` mit interner `Domain`. Weglassen und nicht umschreiben: ein
 *     Kopf ohne festgelegte Bedeutung hat keine Struktur, aus der sich eine
 *     Uebersetzung ableiten liesse, und eine erfundene waere schlimmer als der
 *     Verlust. Gesucht wird die ADRESSE, nicht das Wort (siehe
 *     `nenntInternesZiel`): der Kopfname wird gar nicht geprueft, und der
 *     nackte Dienstname ist kein Teilstringtreffer mehr — sonst faellt bei
 *     einem Ziel namens `api` jedes `X-Api-Version`. Fremde Adressen bleiben
 *     unangetastet, mehrere `set-cookie` bleiben mehrere;
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

/**
 * Eine URL im Fliesstext eines Kopfes. Die ausgeschlossenen Zeichen sind die
 * Trenner, mit denen Koepfe ihre Werte umgeben — `Link` klammert in `<…>`,
 * Listen trennen mit Komma, Parameter mit Semikolon.
 */
const URL_IM_TEXT = /https?:\/\/[^\s,;"'<>()[\]\\]+/gi;

function fuerRegex(roh: string): string {
  return roh.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

/**
 * Nennt dieser WERT das interne Ziel?
 *
 * Die erste Fassung verglich Teilstrings gegen drei Formen, darunter den
 * nackten Dienstnamen. Fuer die vorgesehene Topologie `http://api:3001` ist
 * dieser Dienstname das Wort "api" — und damit fielen `X-Api-Version: 1`, eine
 * Doku-URL auf `api.example.org` und ein Cookie namens `api_session`. Ein
 * Riegel, der harmlose Koepfe verschluckt, ist kein Schutz, sondern ein
 * Ausfall; die Zusage lautet ausdruecklich, dass legitime Koepfe unveraendert
 * bleiben.
 *
 * Deshalb wird jetzt die ADRESSE gesucht und nicht das Wort. Drei Formen, jede
 * mit einer Grenze:
 *
 *   1. **Eine echte URL im Wert**, deren Origin die des Ziels IST. Gefunden
 *      wird sie mit `new URL()`, nicht mit einem Textvergleich — deshalb ist
 *      `https://api.example.org/public` kein Treffer, obwohl das Wort darin
 *      steht. Gross-/Kleinschreibung normalisiert `URL` selbst.
 *   2. **Die Autoritaet ohne Schema** (`api:3001`), aber nur wenn das Ziel
 *      einen Port ausweist, und nur an einer Zeichengrenze: `capitalized-api`
 *      davor und `api:30011` danach sind keine Treffer.
 *   3. **Der Wert BESTEHT aus dem Host** (`api` oder `api:3001`), Leerraum
 *      abgezogen. Das ist der Fall `X-Upstream-Host: api` — eine Adresse, die
 *      allein steht, ist eine Adresse. Als Teilstring wird der nackte
 *      Hostname bewusst NICHT mehr gesucht.
 *
 * Der Kopf-NAME wird gar nicht mehr geprueft: ein Name traegt keine Adresse,
 * er traegt hoechstens dasselbe Wort.
 */
export function nenntInternesZiel(wert: string, ziel: string): boolean {
  const url = new URL(ziel);
  const origin = url.origin.toLowerCase();

  for (const roh of wert.match(URL_IM_TEXT) ?? []) {
    let gefunden: URL;
    try {
      gefunden = new URL(roh);
    } catch {
      continue;
    }
    if (gefunden.origin.toLowerCase() === origin) return true;
  }

  // Ohne Port waere die "Autoritaet" nichts anderes als der nackte Hostname,
  // und genau dieser Teilstringvergleich ist der Fehler, den diese Fassung
  // behebt. Der Fall bleibt trotzdem gedeckt: eine URL faengt Regel 1, ein
  // allein stehender Host faengt Regel 3.
  if (url.port !== "") {
    const grenze = new RegExp(`(?<![A-Za-z0-9._-])${fuerRegex(url.host.toLowerCase())}(?![0-9])`);
    if (grenze.test(wert.toLowerCase())) return true;
  }

  const nurWert = wert.trim().toLowerCase();
  return nurWert === url.host.toLowerCase() || nurWert === url.hostname.toLowerCase();
}

/**
 * Dasselbe fuer ein einzelnes `set-cookie`.
 *
 * Der Wert wird zuerst wie jeder andere geprueft — eine interne URL im
 * Cookiewert ist ein Leck wie ueberall sonst. Zusaetzlich, und NUR strukturell,
 * das `Domain`-Attribut: es nennt einen Host per Definition, also wird es
 * ausgelesen und VERGLICHEN statt im Text gesucht. Das erste Segment ist das
 * Name/Wert-Paar und deshalb kein Attribut — sonst waere ein Cookie namens
 * `domain` ein falscher Treffer.
 */
export function keksNenntInternesZiel(keks: string, ziel: string): boolean {
  if (nenntInternesZiel(keks, ziel)) return true;

  const hostname = new URL(ziel).hostname.toLowerCase();
  for (const attribut of keks.split(";").slice(1)) {
    const trenner = attribut.indexOf("=");
    if (trenner === -1) continue;
    if (attribut.slice(0, trenner).trim().toLowerCase() !== "domain") continue;
    // Ein fuehrender Punkt ist die alte Schreibweise fuer dieselbe Domain.
    const wert = attribut
      .slice(trenner + 1)
      .trim()
      .toLowerCase()
      .replace(/^\./, "");
    if (wert === hostname) return true;
  }
  return false;
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
      // `location` hat eine Bedeutung und deshalb eine Uebersetzung; der
      // Riegel darunter fasst ihn bewusst NICHT an, sonst fiele die
      // Weiterleitung weg, statt relativ zu werden.
      antwortKopf.set("location", uebersetzeWeiterleitung(wert, ziel));
      continue;
    }
    // Jeder uebrige Kopf ist bedeutungslos fuer uns und wird deshalb nicht
    // umgeschrieben, sondern weggelassen, sobald sein WERT die interne
    // Adresse nennt. Nur der Wert: ein Kopfname traegt keine Adresse, und
    // `X-Api-Version` wegzuwerfen, weil das Ziel `api` heisst, waere kein
    // Schutz, sondern ein Ausfall.
    if (nenntInternesZiel(wert, ziel)) continue;
    antwortKopf.set(name, wert);
  }
  for (const keks of oben.headers.getSetCookie()) {
    // Dieselbe Zusage, ohne die Mehrfachheit aufzugeben: das leckende Cookie
    // faellt weg, die uebrigen bleiben eigene Koepfe.
    if (keksNenntInternesZiel(keks, ziel)) continue;
    antwortKopf.append("set-cookie", keks);
  }

  return new Response(oben.body, {
    status: oben.status,
    statusText: oben.statusText,
    headers: antwortKopf,
  });
}
