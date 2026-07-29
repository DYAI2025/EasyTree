import { API_BASE_PATH as CONTRACT_BASE_PATH } from "@easytree/contracts";

/**
 * Basispfad der Fach-API, ABGELEITET aus dem Vertrag (EYT-50).
 *
 * Hier stand eine eigene Zeichenkette `"api/v1"`. Das war dieselbe Falle wie
 * die, die der Konformitaetstest aufdeckt, nur eine Ebene tiefer: zwei frei
 * gepflegte Kopien laufen irgendwann auseinander, und der Test verglich am
 * Ende Kopie gegen Kopie.
 *
 * Der Vertrag fuehrt den Pfad mit fuehrendem Slash (`servers[0].url`),
 * `setGlobalPrefix` erwartet ihn ohne. Diese Datei macht genau diese eine
 * Umformung — und nichts sonst.
 */
export const API_BASE_PATH = CONTRACT_BASE_PATH.replace(/^\/+/, "");
