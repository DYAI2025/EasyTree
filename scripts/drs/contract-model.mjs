/**
 * Strukturpruefung des EasyTree-Delivery-Contracts (EYT-162, Slice 1).
 *
 * Interpretiert das kleine Vokabular aus `.drs/schema/delivery-contract.v1.json`.
 * Die Feldbeschreibung ist Daten, nicht Code: ein neues Feld ist eine
 * Schemaaenderung, keine Codeaenderung. Das ist der Grund fuer diese
 * Umsetzung statt einer handgeschriebenen if-Kaskade.
 *
 * WARUM KEIN JSON SCHEMA
 * ----------------------
 * Ein JSON-Schema-Validator (ajv) waere eine neue Laufzeitabhaengigkeit; die
 * ist fuer diesen Slice ausgeschlossen. Das Vokabular hier ist bewusst so
 * klein, dass es vollstaendig im Schema aufgezaehlt ist.
 *
 * FAIL CLOSED
 * -----------
 * Jeder unbekannte Typ, jedes nicht deklarierte Feld und jede nicht
 * interpretierbare Angabe ist ein BEFUND, nie ein stilles Durchlassen. Ein
 * Validator, der bei unklarer Eingabe nichts meldet, ist ein gruener Haken
 * ohne Messung.
 */

/** Vollstaendiger Git-SHA. Kurz-SHAs sind bewusst ungueltig: sie sind nicht kollisionsfrei bindend. */
const GIT_SHA = /^[0-9a-f]{40}$/;

/**
 * ISO-8601 mit Datum, Zeit und Zonenangabe. Ohne Zone waere ein
 * Beobachtungszeitpunkt nicht vergleichbar, und genau das Vergleichen ist
 * spaeter die Grundlage der Frische-Pruefung.
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Erlaubte Zeichen eines Pfadsegments. Glob-Sterne sind zugelassen, Shell-Metazeichen nicht. */
const PFAD_SEGMENT = /^[A-Za-z0-9._*-]+$/;

function befund(regel, pfad, meldung) {
  return { regel, pfad, meldung };
}

/**
 * Pfadmuster duerfen nicht still kaputt sein.
 *
 * Geprueft wird gegen die Faelle, die ein spaeteres Diff-/Scope-Gate
 * unterlaufen wuerden: absolute Pfade, Ausbrueche mit `..`, Windows-Trenner,
 * leere Segmente, Leerzeichen. `**` bleibt erlaubt, weil der Scope sonst nicht
 * ausdrueckbar waere.
 */
function pruefePfadmuster(wert, pfad) {
  if (typeof wert !== "string") {
    return [befund("type-mismatch", pfad, `erwartet: Zeichenkette, erhalten: ${typeof wert}`)];
  }
  if (wert.length === 0) {
    return [befund("path-pattern-syntax", pfad, "leeres Pfadmuster")];
  }
  if (wert.startsWith("/")) {
    return [befund("path-pattern-syntax", pfad, `absoluter Pfad ist unzulaessig: ${wert}`)];
  }
  if (wert.includes("\\")) {
    return [befund("path-pattern-syntax", pfad, `Backslash ist unzulaessig: ${wert}`)];
  }
  if (wert.endsWith("/")) {
    return [befund("path-pattern-syntax", pfad, `abschliessender Schraegstrich: ${wert}`)];
  }
  const segmente = wert.split("/");
  for (const segment of segmente) {
    if (segment.length === 0) {
      return [befund("path-pattern-syntax", pfad, `leeres Segment: ${wert}`)];
    }
    if (segment === "." || segment === "..") {
      return [befund("path-pattern-syntax", pfad, `Navigationssegment '${segment}': ${wert}`)];
    }
    if (!PFAD_SEGMENT.test(segment)) {
      return [
        befund(
          "path-pattern-syntax",
          pfad,
          `unzulaessige Zeichen im Segment '${segment}': ${wert}`,
        ),
      ];
    }
  }
  return [];
}

function pruefeZeichenkette(wert, regel, pfad) {
  const befunde = [];
  if (typeof wert !== "string") {
    return [befund("type-mismatch", pfad, `erwartet: Zeichenkette, erhalten: ${typeof wert}`)];
  }
  if (typeof regel.const === "string" && wert !== regel.const) {
    befunde.push(
      befund("const-violation", pfad, `erwartet: '${regel.const}', erhalten: '${wert}'`),
    );
  }
  if (Array.isArray(regel.enum) && !regel.enum.includes(wert)) {
    befunde.push(
      befund("enum-violation", pfad, `'${wert}' ist keiner von: ${regel.enum.join(", ")}`),
    );
  }
  if (typeof regel.pattern === "string" && !new RegExp(regel.pattern).test(wert)) {
    befunde.push(befund("pattern-violation", pfad, `'${wert}' passt nicht auf ${regel.pattern}`));
  }
  if (typeof regel.min_length === "number" && wert.length < regel.min_length) {
    befunde.push(
      befund("min-length-violation", pfad, `mindestens ${regel.min_length} Zeichen erwartet`),
    );
  }
  return befunde;
}

function pruefeWert(wert, regel, pfad, definitionen) {
  if (wert === null) {
    return regel.nullable === true
      ? []
      : [befund("null-not-allowed", pfad, "null ist an dieser Stelle nicht zulaessig")];
  }

  const definition = definitionen[regel.type];
  if (definition) {
    // Benannte Definition (heute: gate). Die Angaben am Aufrufort duerfen die
    // Definition nicht aufweichen, deshalb gewinnt die Definition.
    return pruefeWert(wert, { ...regel, ...definition }, pfad, definitionen);
  }

  switch (regel.type) {
    case "string":
      return pruefeZeichenkette(wert, regel, pfad);
    case "git_sha":
      return GIT_SHA.test(wert)
        ? []
        : [
            befund(
              "git-sha-syntax",
              pfad,
              `kein vollstaendiger Git-SHA (40 Stellen, klein, hexadezimal): '${String(wert)}'`,
            ),
          ];
    case "iso_timestamp":
      return ISO_TIMESTAMP.test(wert)
        ? []
        : [
            befund(
              "iso-timestamp-syntax",
              pfad,
              `kein ISO-8601-Zeitpunkt mit Zone: '${String(wert)}'`,
            ),
          ];
    case "path_pattern":
      return pruefePfadmuster(wert, pfad);
    case "boolean":
      return typeof wert === "boolean"
        ? []
        : [befund("type-mismatch", pfad, `erwartet: Wahrheitswert, erhalten: ${typeof wert}`)];
    case "array":
      return pruefeListe(wert, regel, pfad, definitionen);
    case "object":
      return pruefeObjekt(wert, regel, pfad, definitionen);
    default:
      // Fail closed: ein unbekannter Typ darf nicht als "nicht pruefbar, also
      // in Ordnung" durchlaufen.
      return [
        befund("unknown-schema-type", pfad, `unbekannter Schematyp: '${String(regel.type)}'`),
      ];
  }
}

function pruefeListe(wert, regel, pfad, definitionen) {
  if (!Array.isArray(wert)) {
    return [befund("type-mismatch", pfad, `erwartet: Liste, erhalten: ${typeof wert}`)];
  }
  const befunde = [];
  if (typeof regel.min_items === "number" && wert.length < regel.min_items) {
    befunde.push(
      befund(
        "array-min-items",
        pfad,
        `mindestens ${regel.min_items} Eintraege erwartet, ${wert.length} vorhanden`,
      ),
    );
  }
  if (regel.unique === true) {
    const gesehen = new Set();
    wert.forEach((eintrag, index) => {
      const schluessel = JSON.stringify(eintrag);
      if (gesehen.has(schluessel)) {
        befunde.push(
          befund("array-duplicate", `${pfad}[${index}]`, `doppelter Eintrag: ${schluessel}`),
        );
      }
      gesehen.add(schluessel);
    });
  }
  if (regel.item) {
    wert.forEach((eintrag, index) => {
      befunde.push(...pruefeWert(eintrag, regel.item, `${pfad}[${index}]`, definitionen));
    });
  }
  return befunde;
}

function pruefeObjekt(wert, regel, pfad, definitionen) {
  if (typeof wert !== "object" || Array.isArray(wert)) {
    return [
      befund(
        "type-mismatch",
        pfad,
        `erwartet: Objekt, erhalten: ${Array.isArray(wert) ? "Liste" : typeof wert}`,
      ),
    ];
  }
  const felder = regel.fields ?? {};
  const befunde = [];

  for (const [name, feldregel] of Object.entries(felder)) {
    const feldpfad = pfad ? `${pfad}.${name}` : name;
    if (!Object.hasOwn(wert, name)) {
      if (feldregel.required === true) {
        befunde.push(befund("field-required", feldpfad, "Pflichtfeld fehlt"));
      }
      continue;
    }
    befunde.push(...pruefeWert(wert[name], feldregel, feldpfad, definitionen));
  }

  // Strikt: jedes Objekt im Vertrag ist geschlossen. Ohne diese Pruefung
  // koennte ein source_binding kopierte Produktwahrheit als Zusatzfeld
  // tragen und damit eine zweite Autoritaet aufmachen.
  for (const name of Object.keys(wert)) {
    if (!Object.hasOwn(felder, name)) {
      befunde.push(
        befund("unknown-field", pfad ? `${pfad}.${name}` : name, "nicht im Schema deklariert"),
      );
    }
  }
  return befunde;
}

/**
 * Prueft einen Vertrag gegen die geladene Feldbeschreibung.
 *
 * @param {unknown} vertrag geparster Vertragsinhalt
 * @param {{ root: object, definitionen?: object }} schema geladene Feldbeschreibung
 * @returns {{ regel: string, pfad: string, meldung: string }[]}
 */
export function pruefeStruktur(vertrag, schema) {
  if (typeof vertrag !== "object" || vertrag === null || Array.isArray(vertrag)) {
    return [befund("type-mismatch", "", "der Vertrag ist kein JSON-Objekt")];
  }
  return pruefeWert(vertrag, schema.root, "", schema.definitionen ?? {});
}
