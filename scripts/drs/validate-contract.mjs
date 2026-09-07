#!/usr/bin/env node
/**
 * SHADOW-Validator fuer den EasyTree-Delivery-Contract (EYT-162, Slice 1).
 *
 * WAS DIESER BEFEHL IST
 * ---------------------
 * Eine lokale, deterministische Pruefung, ob ein Vertrag in sich stimmig ist:
 * Struktur gegen `.drs/schema/delivery-contract.v1.json`, danach die
 * feldruebergreifenden Invarianten aus `contract-invariants.mjs`.
 *
 * WAS DIESER BEFEHL NICHT IST
 * ---------------------------
 * Keine Abnahme, keine CI-Grenze, keine Merge-Autoritaet. Er liest den
 * Vertrag als Aussage und prueft die Aussage gegen sich selbst — er misst
 * weder das Repository noch das Diff noch die Frische der vorgelagerten
 * Quellen. Deshalb schreibt jede Ausgabe `authoritative=no`.
 *
 * EXIT-CODES (fail closed)
 *   0  geprueft, keine Befunde
 *   1  Befunde vorhanden
 *   2  Eingabe nicht pruefbar (Datei fehlt, kein JSON, Schema nicht lesbar)
 *
 * Ein nicht pruefbarer Vertrag ist ausdruecklich NICHT Exit 0. Sonst waere ein
 * Tippfehler im Dateinamen ein gruener Lauf.
 */
import { readFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { pruefeInvarianten } from "./contract-invariants.mjs";
import { pruefeStruktur } from "./contract-model.mjs";

/** Repository-relativer Pfad des Schemas. */
export const SCHEMA_PFAD = ".drs/schema/delivery-contract.v1.json";
/** Repository-relativer Pfad des EYT-162-Beispielvertrags. */
export const CONTRACT_PFAD = ".drs/contracts/EYT-162.contract.json";
/** Repository-relativer Pfad dieses Validators — die Testsuite ruft ihn darueber auf. */
export const VALIDATOR_PFAD = "scripts/drs/validate-contract.mjs";

const REPO_WURZEL = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Liest eine JSON-Datei fail-closed.
 *
 * Gibt niemals ein teilweises Ergebnis zurueck: entweder der geparste Inhalt
 * oder ein benannter Fehler. Ein `catch` mit Rueckgabe `{}` waere hier der
 * klassische stille Gruen-Fall.
 */
export function leseJson(pfad) {
  let roh;
  try {
    roh = readFileSync(pfad, "utf8");
  } catch (fehler) {
    return { ok: false, fehler: `Datei nicht lesbar: ${pfad} (${fehler.code ?? fehler.message})` };
  }
  try {
    return { ok: true, inhalt: JSON.parse(roh) };
  } catch (fehler) {
    return { ok: false, fehler: `kein gueltiges JSON: ${pfad} (${fehler.message})` };
  }
}

/**
 * Prueft einen bereits geparsten Vertrag.
 *
 * Die Invarianten laufen nur bei sauberer Struktur: sonst wuerde ein
 * fehlendes Pflichtfeld als Invariantenverletzung erscheinen und der Bericht
 * wuerde die Ursache verdecken.
 *
 * @param {unknown} vertrag
 * @param {{ repoWurzel?: string }} optionen
 */
export function validiereVertrag(vertrag, optionen = {}) {
  const wurzel = optionen.repoWurzel ?? REPO_WURZEL;
  const schema = leseJson(`${wurzel}${SCHEMA_PFAD}`);
  if (!schema.ok) {
    return {
      ok: false,
      nichtPruefbar: true,
      befunde: [{ regel: "schema-unreadable", pfad: SCHEMA_PFAD, meldung: schema.fehler }],
    };
  }

  const struktur = pruefeStruktur(vertrag, schema.inhalt);
  if (struktur.length > 0) {
    return { ok: false, nichtPruefbar: false, befunde: struktur };
  }

  const invarianten = pruefeInvarianten(vertrag);
  return { ok: invarianten.length === 0, nichtPruefbar: false, befunde: invarianten };
}

function main(argumente) {
  if (argumente.length === 0) {
    stderr.write(`usage: node ${VALIDATOR_PFAD} <vertrag.json> [<vertrag.json> ...]\n`);
    return 2;
  }

  let nichtPruefbar = 0;
  let befundeGesamt = 0;

  for (const pfad of argumente) {
    const datei = leseJson(pfad);
    if (!datei.ok) {
      nichtPruefbar += 1;
      stderr.write(`  NICHT PRUEFBAR  ${pfad}: ${datei.fehler}\n`);
      continue;
    }
    const ergebnis = validiereVertrag(datei.inhalt);
    if (ergebnis.nichtPruefbar) {
      nichtPruefbar += 1;
      for (const b of ergebnis.befunde) stderr.write(`  NICHT PRUEFBAR  ${pfad}: ${b.meldung}\n`);
      continue;
    }
    befundeGesamt += ergebnis.befunde.length;
    if (ergebnis.befunde.length === 0) {
      stdout.write(`  OK    ${pfad}\n`);
    } else {
      for (const b of ergebnis.befunde) {
        stdout.write(`  BEFUND ${b.regel}${b.pfad ? ` @ ${b.pfad}` : ""}: ${b.meldung}\n`);
      }
    }
  }

  // Greppbare Ergebniszeile, dieselbe Form wie [container-smoke] und
  // [tenant-isolation]. `authoritative=no` steht bewusst in JEDER Ausgabe:
  // ein gruener Lauf dieses Werkzeugs ist kein Abnahmebeleg.
  stdout.write(
    `[drs-contract] mode=shadow authoritative=no contracts=${argumente.length} findings=${befundeGesamt} unverifiable=${nichtPruefbar}\n`,
  );

  if (nichtPruefbar > 0) return 2;
  return befundeGesamt > 0 ? 1 : 0;
}

// Nur ausfuehren, wenn direkt aufgerufen — beim Import aus der Testsuite nicht.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  exit(main(argv.slice(2)));
}
