/**
 * Transportschemata der Planung (EYT-47, EYT-79).
 *
 * ## Warum hier keine Domaintypen stehen
 *
 * `@easytree/domain` exportiert `TimeInterval` als Klasse mit privaten Feldern
 * und die Bezeichner als nominal gebrandete Strings. Beides **kann** nicht über
 * die Leitung: `JSON.stringify` einer Klasse mit privatem Zustand ergibt ohne
 * `toJSON` ein leeres Objekt, und der Rückweg müsste durch
 * `TimeInterval.create` laufen, was ein deserialisiertes Objekt nie tut.
 *
 * Damit ist EYT-47 AK 5 („Domainentitäten werden nicht direkt als
 * Transportobjekte veröffentlicht") keine Stilfrage, sondern eine
 * Typeigenschaft. `packages/contracts` führt `@easytree/domain` deshalb weder
 * als Abhängigkeit noch als Import — der Architekturtest prüft das.
 *
 * Die Umwandlung DTO ↔ Domain gehört an die HTTP-Naht in
 * `apps/api/src/modules/<modul>/interface/http` und kommt mit EYT-50. Bis dahin gibt
 * es sie nicht, und dieses Paket behauptet auch nicht, sie zu haben.
 */
import { z } from "zod";

import { isValidIsoWeekKey } from "./iso-week.js";

import { IdSchema, InstantSchema, LocalDateSchema } from "../primitives.js";

/**
 * Halb-offenes Intervall als Transportform. Entspricht `TimeInterval` der Domain.
 *
 * Die Reihenfolge wird hier geprüft, nicht erst bei der Umwandlung in die
 * Domain: sonst gälte ein Kommando mit `endUtc <= startUtc` als vertragskonform
 * und schlüge erst tief im Server fehl. Genau das war der Prototypfehler
 * (`FIND-004`) — nur eine Schicht höher.
 *
 * **Grenze der Veröffentlichung:** JSON Schema kann „Ende nach Beginn" nicht
 * ausdrücken. Das erzeugte OpenAPI-Dokument trägt die Regel deshalb nicht; ein
 * generierter Client kann ein verkehrtes Intervall senden. Abgelehnt wird es
 * trotzdem — von diesem Schema zur Laufzeit.
 */
export const TimeIntervalDtoSchema = z
  .strictObject({
    startUtc: InstantSchema,
    endUtc: InstantSchema,
  })
  .refine((interval) => interval.endUtc > interval.startUtc, {
    message: "endUtc muss nach startUtc liegen (halb-offenes Intervall)",
    path: ["endUtc"],
  });

export type TimeIntervalDto = z.infer<typeof TimeIntervalDtoSchema>;

/**
 * Konfliktcodes des Transports.
 *
 * Absichtlich als eigene Liste und nicht aus dem Planungsmodul importiert: der
 * Vertrag ist versioniert und darf sich nicht ändern, nur weil ein internes
 * Enum wächst. Ein Test in `apps/api` prüft, dass jeder Domaincode hier eine
 * Entsprechung hat — die Richtung „Domain ⊆ Transport" ist die, die zählt.
 */
export const CONFLICT_CODE_VALUES = [
  "EMPLOYEE_INTERVAL_OVERLAP",
  "EMPLOYEE_WEEKLY_CAPACITY",
  "EMPLOYEE_INACTIVE",
  "WORKSITE_NOT_PUBLISHABLE",
] as const;

export const ConflictCodeSchema = z.enum(CONFLICT_CODE_VALUES);

export const PlanningConflictDtoSchema = z.strictObject({
  code: ConflictCodeSchema,
  /** `true` verhindert die Veröffentlichung, `false` ist eine Warnung (EYT-74). */
  blocking: z.boolean(),
  /** Menschenlesbare Begründung. Nie der einzige Träger der Bedeutung — dafür ist `code` da. */
  message: z.string(),
});

export type PlanningConflictDto = z.infer<typeof PlanningConflictDtoSchema>;

export const AssignmentDtoSchema = z.strictObject({
  id: IdSchema,
  employeeId: IdSchema,
  worksiteId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type AssignmentDto = z.infer<typeof AssignmentDtoSchema>;

/**
 * Der ISO-Wochenschluessel als EIN Schema fuer alle oeffentlichen Felder (EYT-88).
 *
 * Zuvor stand an fuenf Stellen ein eigener regulaerer Ausdruck. Vier davon
 * kannten nur das Muster; die Kalenderregel hing allein an der Leseabfrage.
 * Damit haetten Leseroute, Validierungsroute, Publish-Kommando und
 * Antwortvertrag unterschiedliche Regeln getragen — `2025-W53` waere ueber die
 * Abfrage abgelehnt und ueber das Publish-Kommando angenommen worden.
 *
 * Ein Schema, viele Verwendungen — inzwischen auch im Kostenbereich. Wer eine
 * weitere Stelle hinzufuegt, nimmt dieses hier und nicht wieder einen eigenen
 * Ausdruck, und traegt sie als Zeile in `STELLEN` (`test/iso-week-key.test.ts`)
 * ein — der Waechter merkt eine ausgelassene Zeile nicht von selbst.
 *
 * Das Muster bleibt vorgeschaltet, obwohl `isValidIsoWeekKey` die Form selbst
 * prueft: es liefert die praezisere Meldung fuer den haeufigen Tippfehler,
 * bevor die Kalenderrechnung ueberhaupt anlaeuft.
 */
export const IsoWeekKeySchema = z
  .string()
  .regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, "Wochenschluessel im Format 2026-W32")
  .refine(isValidIsoWeekKey, {
    message:
      "Wochenschluessel bezeichnet keine reale ISO-Woche (etwa W53 in einem Jahr mit 52 Wochen)",
  })
  .describe(
    "ISO-Woche im Format 2026-W32. Eine 53. Woche ist nur in ISO-Jahren gueltig, die tatsaechlich 53 Wochen haben.",
  );

/**
 * Abfrage eines Planungsfensters.
 *
 * `weekKey` statt Datumsbereich: die Woche ist bereits eine fachliche Einheit
 * mit dokumentierter Zeitzonen- und Wochenregel (EYT-74). Ein freier
 * Datumsbereich würde die Wochenlogik erneut auf den Client verlagern — genau
 * die Doppelimplementierung, die `FIND-003` verursacht hat.
 */
export const PlanningWindowQuerySchema = z.strictObject({
  /** Siehe {@link IsoWeekKeySchema} — Muster plus jahresabhaengige Kalenderregel. */
  weekKey: IsoWeekKeySchema,
});

export type PlanningWindowQuery = z.infer<typeof PlanningWindowQuerySchema>;

/**
 * Herkunft der angezeigten Zuweisungen (EYT-50).
 *
 * Ohne diese Angabe konnte das Fenster die Zuweisungen eines ENTWURFS zeigen
 * und daneben `publishedVersionId` einer bereits veroeffentlichten Version —
 * die Oberflaeche zeigte dann "Veroeffentlichte Version X" ueber Daten, die
 * gar nicht zu X gehoeren. Ein Vergleich mit der Mitarbeitersicht (AK9) waere
 * damit ein Vergleich von Aepfeln mit Birnen.
 *
 * `null` heisst: es gibt fuer diese Woche ueberhaupt keine Version.
 */
export const SourceVersionSchema = z.strictObject({
  id: IdSchema,
  state: z.enum(["draft", "published"]),
});

export type SourceVersion = z.infer<typeof SourceVersionSchema>;

/**
 * Auswaehlbare Ressource einer Planungswoche — Beschaeftigte oder Baustelle.
 *
 * Bewusst drei Felder und keines mehr. Die Planerin braucht zum Auswaehlen
 * einen Namen, zum Absenden eine Id und zum Unterscheiden den Aktivstatus.
 * `employees` traegt Personenbezug (Migration `0005`); alles darueber hinaus —
 * Rolle, Qualifikation, Kontaktdaten, Adresse der Baustelle — bleibt draussen,
 * weil kein Nutzerschritt es braucht. Ein Feld, das niemand liest, ist hier
 * kein Komfort, sondern eine unnoetig veroeffentlichte Personeneigenschaft.
 */
export const PlanningResourceSchema = z.strictObject({
  id: IdSchema,
  /** Anzeigename. In der Datenbank `employees.display_name` bzw. `worksites.name`. */
  label: z.string().min(1),
  /**
   * Steuert die **Auswaehlbarkeit**, nicht die Sichtbarkeit.
   *
   * Geliefert werden alle tenant-sichtbaren Eintraege, auch inaktive: ein
   * bestehender Einsatz auf eine inaktive Person muss weiterhin ihren Namen
   * zeigen statt einer nackten Uuid. Neue Einsaetze duerfen nur auf `active:
   * true` zeigen — diese Regel setzt die Oberflaeche durch, und der Server
   * pruefen wird sie erneut, sobald der Schreibpfad existiert.
   */
  active: z.boolean(),
});

export type PlanningResource = z.infer<typeof PlanningResourceSchema>;

/**
 * Die auswaehlbaren Stammdaten der Woche.
 *
 * Sie reisen mit dem Planungsfenster, statt ueber eigene Listenrouten: die
 * Planerin oeffnet eine Woche und braucht dieselbe Mandantengrenze, dieselbe
 * Transaktionsklammer und denselben Zeitpunkt wie fuer Versionen und
 * Zuweisungen. Zwei getrennte Routen koennten zwei verschiedene Zustaende
 * liefern — eine Zuweisung auf eine Person, die die zweite Antwort nicht mehr
 * kennt. Ein Roundtrip, eine Wahrheit.
 */
export const PlanningResourcesSchema = z.strictObject({
  employees: z.array(PlanningResourceSchema),
  worksites: z.array(PlanningResourceSchema),
});

export type PlanningResources = z.infer<typeof PlanningResourcesSchema>;

/**
 * Ein Teameintrag, wie ihn ein KOMMANDO traegt — Person und Intervall.
 *
 * Ohne Assignment-Id, und das ist kein Versehen: beim Anlegen existiert sie noch
 * nicht, der Server vergibt sie. Die Antwort fuehrt sie dann mit (siehe
 * {@link WorksiteDayTeamMemberSchema}). Ein gemeinsames Schema fuer beide
 * Richtungen brauchte ein optionales Feld — und ein optionales Feld heisst,
 * dass niemand mehr sagen kann, ob eine fehlende Id ein neuer Eintrag oder ein
 * Datenverlust ist.
 */
export const WorksiteDayTeamEntrySchema = z.strictObject({
  employeeId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type WorksiteDayTeamEntry = z.infer<typeof WorksiteDayTeamEntrySchema>;

/**
 * Die zwei Teamregeln — einmal geschrieben, von beiden Kommandos benutzt.
 *
 * 1. Dasselbe `(employeeId, interval)`-Paar darf nicht zweimal vorkommen.
 * 2. Zwei Intervalle DERSELBEN Person duerfen sich nicht ueberlappen.
 *
 * Getrennte, nicht ueberlappende Intervalle derselben Person bleiben ausdruecklich
 * erlaubt: jemand steht vormittags und nachmittags auf derselben Baustelle, und
 * das ist ein normaler Tag, kein Konflikt (Confluence 41484289 §2 Nr. 4).
 *
 * ## Warum das Duplikat VOR der Ueberlappung geprueft wird
 *
 * Ein identisches Paar ueberlappt sich selbst. Ohne Vorrang traege der
 * Doppeleintrag die Ueberlappungsmeldung, und die Planerin suchte nach einer
 * Zeitkollision, wo sie in Wahrheit zweimal dieselbe Zeile abgeschickt hat.
 *
 * ## Warum Zeichenketten verglichen werden und nicht `Date`
 *
 * `InstantSchema` laesst genau EINE Schreibweise zu: UTC, drei Nachkommastellen,
 * `Z`. Damit haben alle Werte dieselbe Laenge und dieselbe Stellenordnung, und
 * die lexikografische Reihenfolge IST die zeitliche. Ein `Date.parse` waere ein
 * zweiter Weg zur selben Aussage — und einer, der bei einem kaputten Wert still
 * `NaN` liefert, womit jeder Vergleich `false` ergaebe und die Regel schwiege.
 */
function pruefeTeamregeln(eintraege: readonly WorksiteDayTeamEntry[], ctx: z.RefinementCtx): void {
  for (let i = 0; i < eintraege.length; i += 1) {
    for (let j = i + 1; j < eintraege.length; j += 1) {
      const a = eintraege[i];
      const b = eintraege[j];
      if (a === undefined || b === undefined) continue;
      if (a.employeeId !== b.employeeId) continue;

      if (a.interval.startUtc === b.interval.startUtc && a.interval.endUtc === b.interval.endUtc) {
        ctx.addIssue({
          code: "custom",
          path: [j],
          message:
            "Derselbe Eintrag steht zweimal im Team: gleiche Person, gleiches Intervall. " +
            "Gemeint ist vermutlich ein zweites, anderes Intervall.",
        });
        continue;
      }

      if (a.interval.startUtc < b.interval.endUtc && b.interval.startUtc < a.interval.endUtc) {
        ctx.addIssue({
          code: "custom",
          path: [j],
          message:
            "Zwei Intervalle derselben Person ueberlappen sich. Getrennte Intervalle am " +
            "selben Tag sind erlaubt, sich ueberschneidende nicht.",
        });
      }
    }
  }
}

/**
 * Das Team eines Kommandos: mindestens EINE Person, und die Regeln oben.
 *
 * `min(1)` ist eine Produktentscheidung, keine Vorsicht: Confluence 41484289
 * §2 Nr. 8 verlangt, dass ein leerer Baustellentag nicht still entsteht. Die
 * ANTWORT darf `[]` trotzdem tragen — siehe {@link WorksiteDayDtoSchema}.
 *
 * Die Regeln sitzen am Array und nicht am umgebenden Kommando. Das ist kein
 * Stil: `z.toJSONSchema` gibt fuer ein Objekt mit `superRefine` weiterhin
 * `additionalProperties: false` aus, aber die Regel gehoert fachlich zur Liste,
 * und so tragen beide Kommandos sie ohne eine zweite Ableitung.
 */
export const WorksiteDayTeamCommandSchema = z
  .array(WorksiteDayTeamEntrySchema)
  .min(1, "Ein Baustellentag wird nicht ohne Team angelegt oder geleert")
  .superRefine(pruefeTeamregeln);

/**
 * Ein Teammitglied, wie es die ANTWORT traegt — mit der Assignment-Id.
 *
 * Sie ist die Bruecke zur bestehenden Assignment-Projektion: dieselbe Zuweisung
 * erscheint einmal unter `assignments` und einmal hier. Das Fenster prueft, dass
 * beide Seiten dasselbe sagen (siehe {@link PlanningWindowSchema}).
 */
export const WorksiteDayTeamMemberSchema = z.strictObject({
  assignmentId: IdSchema,
  employeeId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type WorksiteDayTeamMember = z.infer<typeof WorksiteDayTeamMemberSchema>;

/**
 * Ein Baustellentag, wie ihn die Antwort zeigt.
 *
 * ## Zwei Ids, zwei Lebensdauern — und keine ist ein Alias der anderen
 *
 * `worksiteDayId` ist die IDENTITAET: eine Zeile je (Organisation, Baustelle,
 * lokaler Tag), versionsuebergreifend stabil (Migration `0019`). Sie ueberlebt
 * jede Veroeffentlichung. `configurationId` ist die REVISION: der Planungsstand
 * genau dieses Tages in genau einer Planversion. Wird eine Version kopiert,
 * entsteht eine NEUE Konfiguration auf DERSELBEN Identitaet.
 *
 * Wer die beiden zusammenlegt, verliert genau die Faehigkeit, um derentwillen
 * es sie gibt: denselben Tag ueber Draft -> Publish -> Folgedraft
 * wiederzuerkennen. `UpdateWorksiteDayTeamCommandSchema` adressiert deshalb die
 * IDENTITAET und nennt die Revision gar nicht.
 *
 * ## Warum `team` hier leer sein darf
 *
 * Die Kommandos verbieten `[]`, dieser Vertrag erlaubt es — die Asymmetrie ist
 * Absicht. Ein Antwortschema, das den leeren Tag ablehnt, macht aus EINER
 * unvollstaendigen Zeile eine unlesbare GESAMTE Planungsantwort: der Client
 * verwirft dann das ganze Fenster und die Planerin sieht nichts mehr. Die
 * Vollstaendigkeit eines Tages ist eine Publish-Bedingung, keine Lesebedingung.
 */
export const WorksiteDayDtoSchema = z.strictObject({
  /** Stabile Identitaet des Baustellentags. Ueberlebt jede Planversion. */
  worksiteDayId: IdSchema,
  /** Die konkrete revisionsgebundene Konfiguration in EINER Planversion. */
  configurationId: IdSchema,
  worksiteId: IdSchema,
  localDate: LocalDateSchema,
  /** Fortschreibungszaehler der Konfiguration; `expectedLockVersion` vergleicht dagegen. */
  lockVersion: z.number().int().min(0),
  team: z.array(WorksiteDayTeamMemberSchema),
});

export type WorksiteDayDto = z.infer<typeof WorksiteDayDtoSchema>;

export const PlanningWindowSchema = z
  .strictObject({
    weekKey: IsoWeekKeySchema,
    /** IANA-Zeitzone, nach der die Woche abgegrenzt wurde. Mitgeliefert, damit die
     * UI die Wochengrenze nicht selbst raten muss. */
    timeZone: z.string(),
    assignments: z.array(AssignmentDtoSchema),
    /**
     * Version, ZU DER die `assignments` gehoeren — Entwurf oder veroeffentlicht.
     * Getrennt von `publishedVersionId`, weil beides gleichzeitig gelten kann.
     */
    sourceVersion: SourceVersionSchema.nullable(),
    /**
     * Id der zuletzt veröffentlichten Planversion, `null` solange nichts
     * veröffentlicht ist. Sagt NICHTS darüber, ob die angezeigten Zuweisungen
     * daher stammen — dafür ist `sourceVersion` da.
     */
    publishedVersionId: IdSchema.nullable(),
    /**
     * Auswaehlbare Beschaeftigte und Baustellen dieses Mandanten. Siehe
     * {@link PlanningResourcesSchema} — mitgeliefert, nicht nachgeladen.
     */
    resources: PlanningResourcesSchema,
    /**
     * Die Baustellentage dieser Woche (EYT-147 M2) — ADDITIV, deshalb optional.
     *
     * Fehlt das Feld, ist die Antwort ein Bestandsfenster ohne Baustellentage
     * und bleibt gueltig. Das ist keine Nachlaessigkeit, sondern die Bedingung
     * dafuer, dass diese Erweiterung additiv IST: der heutige Server sendet das
     * Feld nicht, und ein Pflichtfeld haette seine Antwort ab sofort als
     * Vertragsbruch verworfen — die Planung waere leer, ohne dass sich am
     * Server etwas geaendert haette.
     *
     * `.default([])` waere hier die falsche Abkuerzung: gemessen mit zod 4.4.3
     * fuehrt `z.toJSONSchema` ein Feld mit Vorgabewert unter `required`. Das
     * veroeffentlichte Dokument behauptete dann ein Feld, das nie mitkommt.
     *
     * Die bestehende `assignments`-Projektion bleibt unberuehrt: Zuweisungen
     * ohne Baustellentag sind weiterhin gueltig (Migration `0019` legt die
     * Referenz ausdruecklich NULLABLE an, ohne Backfill).
     */
    worksiteDays: z.array(WorksiteDayDtoSchema).optional(),
  })
  .superRefine((fenster, ctx) => {
    // Feldweise Gueltigkeit genuegt hier nicht: die AUSSAGE steckt in der
    // Beziehung der Felder. Ohne diese Regeln waeren formal gueltige, fachlich
    // widerspruechliche Antworten moeglich — und die faenden erst in der
    // Oberflaeche auf, als "Veroeffentlichte Version X" ueber fremden Daten.

    // Jede angezeigte Zuweisung muss aufloesbar sein. Zeigt eine Zuweisung auf
    // eine Person oder Baustelle, die `resources` nicht kennt, kann die
    // Oberflaeche nur eine nackte Uuid rendern — und ein Mandantenleck saehe
    // genau so aus: eine fremde Id, zu der es lokal keinen Namen gibt. Die
    // Antwort wird deshalb hier verworfen, nicht in der Oberflaeche kaschiert.
    const bekannteBeschaeftigte = new Set(fenster.resources.employees.map((e) => e.id));
    const bekannteBaustellen = new Set(fenster.resources.worksites.map((w) => w.id));
    fenster.assignments.forEach((einsatz, index) => {
      if (!bekannteBeschaeftigte.has(einsatz.employeeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["assignments", index, "employeeId"],
          message:
            "Zuweisung verweist auf eine Beschaeftigte, die nicht in resources.employees steht — nicht aufloesbar.",
        });
      }
      if (!bekannteBaustellen.has(einsatz.worksiteId)) {
        ctx.addIssue({
          code: "custom",
          path: ["assignments", index, "worksiteId"],
          message:
            "Zuweisung verweist auf eine Baustelle, die nicht in resources.worksites steht — nicht aufloesbar.",
        });
      }
    });

    // Baustellentage (EYT-147 M2). Bewusst HIER und nicht am Ende dieser
    // Funktion: die Zweige unten enden jeweils mit `return`, und angehaengte
    // Regeln liefen bei `sourceVersion === null` oder `"published"` nie —
    // ausgerechnet der Fall, den Regel (6) pruefen soll.
    const tage = fenster.worksiteDays;
    if (tage !== undefined) {
      // Jede Zuweisung EINMAL nachschlagbar machen. Ein lineares Suchen je
      // Teammitglied waere nicht nur quadratisch, es verleitete auch dazu, den
      // Treffer als Beweis zu nehmen — geprueft werden muss er trotzdem.
      const einsaetze = new Map(fenster.assignments.map((einsatz) => [einsatz.id, einsatz]));
      /** Assignment-Id -> Index des Tages, dessen Team sie zuerst nannte. */
      const belegtVon = new Map<string, number>();
      /** worksiteDayId -> Index der Zeile, die diese Identitaet zuerst fuehrte. */
      const identitaeten = new Map<string, number>();
      /** configurationId -> Index der Zeile, die diese Revision zuerst fuehrte. */
      const revisionen = new Map<string, number>();

      tage.forEach((tag, tagIndex) => {
        if (!bekannteBaustellen.has(tag.worksiteId)) {
          ctx.addIssue({
            code: "custom",
            path: ["worksiteDays", tagIndex, "worksiteId"],
            message:
              "Baustellentag verweist auf eine Baustelle, die nicht in resources.worksites steht — nicht aufloesbar.",
          });
        }

        // Eine Tagesidentitaet und eine Konfigurationsrevision erscheinen im
        // Fenster je HOECHSTENS EINMAL als primaere Zeile. Beide Achsen einzeln,
        // nicht als Paar: `(worksiteDayId, configurationId)` waere schon dann
        // eindeutig, wenn derselbe Tag zweimal mit verschiedenen Revisionen
        // stuende — und genau das ist die zweite Stale-Wahrheit je Tag, die
        // Migration 0019 R-20 ausschliesst. Umgekehrt gilt `unique
        // (plan_version_id, worksite_day_id)`: eine Revision gehoert zu genau
        // einer Identitaet.
        const identitaetZuerst = identitaeten.get(tag.worksiteDayId);
        if (identitaetZuerst === undefined) {
          identitaeten.set(tag.worksiteDayId, tagIndex);
        } else {
          ctx.addIssue({
            code: "custom",
            path: ["worksiteDays", tagIndex, "worksiteDayId"],
            message:
              `Dieselbe Tagesidentitaet steht bereits in worksiteDays[${identitaetZuerst}]. ` +
              "Ein Baustellentag erscheint je Fenster einmal — sonst traegt er zwei lockVersion-Staende.",
          });
        }

        const revisionZuerst = revisionen.get(tag.configurationId);
        if (revisionZuerst === undefined) {
          revisionen.set(tag.configurationId, tagIndex);
        } else {
          ctx.addIssue({
            code: "custom",
            path: ["worksiteDays", tagIndex, "configurationId"],
            message:
              `Dieselbe Konfigurationsrevision steht bereits in worksiteDays[${revisionZuerst}]. ` +
              "Eine Tageskonfiguration gehoert zu genau einer Tagesidentitaet.",
          });
        }

        tag.team.forEach((mitglied, mitgliedIndex) => {
          const pfad: (string | number)[] = ["worksiteDays", tagIndex, "team", mitgliedIndex];
          const einsatz = einsaetze.get(mitglied.assignmentId);

          if (einsatz === undefined) {
            ctx.addIssue({
              code: "custom",
              path: [...pfad, "assignmentId"],
              message:
                "Teammitglied verweist auf eine Zuweisung, die nicht unter assignments steht. " +
                "Die Tageskarte zeigte damit eine Besetzung, die das Fenster selbst nicht kennt.",
            });
            return;
          }

          // Die Tageskarte und die Zuweisungsliste sind ZWEI Sichten auf
          // dieselbe Tatsache. Weichen sie ab, zeigt die Oberflaeche je nach
          // Ansicht etwas anderes an — und beide Male sieht es richtig aus.
          if (einsatz.employeeId !== mitglied.employeeId) {
            ctx.addIssue({
              code: "custom",
              path: [...pfad, "employeeId"],
              message: "Teammitglied und referenzierte Zuweisung nennen verschiedene Personen.",
            });
          }
          if (
            einsatz.interval.startUtc !== mitglied.interval.startUtc ||
            einsatz.interval.endUtc !== mitglied.interval.endUtc
          ) {
            ctx.addIssue({
              code: "custom",
              path: [...pfad, "interval"],
              message: "Teammitglied und referenzierte Zuweisung nennen verschiedene Intervalle.",
            });
          }
          // Dritte Achse derselben Aussage — und die einzige, die nicht aus dem
          // Teameintrag selbst kommt: die Baustelle steht am TAG, nicht am
          // Mitglied. Person und Intervall koennen vollstaendig uebereinstimmen,
          // waehrend die Zuweisung auf einer anderen Baustelle gefuehrt wird;
          // beide Ansichten saehen dann fuer sich richtig aus. Die
          // Aufloesbarkeitspruefung oben faengt das nicht: sie fragt nur, ob die
          // Baustelle BEKANNT ist, nicht ob es DIESELBE ist.
          if (einsatz.worksiteId !== tag.worksiteId) {
            ctx.addIssue({
              code: "custom",
              path: [...pfad, "assignmentId"],
              message:
                "Teammitglied verweist auf eine Zuweisung einer ANDEREN Baustelle als der des Baustellentags.",
            });
          }

          const zuerst = belegtVon.get(mitglied.assignmentId);
          if (zuerst === undefined) {
            belegtVon.set(mitglied.assignmentId, tagIndex);
          } else {
            // Eine Zuweisung gehoert zu genau EINER Tageskonfiguration
            // (Migration `0019`: `assignments.worksite_day_configuration_id` ist
            // eine einzelne Spalte). Zweimal genannt hiesse, dieselbe Person
            // waere zur selben Zeit auf zwei Karten verplant.
            ctx.addIssue({
              code: "custom",
              path: [...pfad, "assignmentId"],
              message:
                `Dieselbe Zuweisung steht bereits im Team von worksiteDays[${zuerst}]. ` +
                "Eine Zuweisung gehoert zu genau einem Baustellentag.",
            });
          }
        });
      });

      if (tage.length > 0 && fenster.sourceVersion === null) {
        ctx.addIssue({
          code: "custom",
          path: ["worksiteDays"],
          message:
            "Ohne sourceVersion kann es keine Baustellentage geben — sie haetten keine Herkunft.",
        });
      }
    }

    if (fenster.sourceVersion === null) {
      if (fenster.assignments.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["assignments"],
          message:
            "Ohne sourceVersion kann es keine Zuweisungen geben — sie haetten keine Herkunft.",
        });
      }
      if (fenster.publishedVersionId !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["publishedVersionId"],
          message:
            "Eine veroeffentlichte Version existiert, wird aber nicht angezeigt: dann muesste sourceVersion sie nennen.",
        });
      }
      return;
    }

    if (fenster.sourceVersion.state === "published") {
      if (fenster.publishedVersionId !== fenster.sourceVersion.id) {
        ctx.addIssue({
          code: "custom",
          path: ["publishedVersionId"],
          message:
            "Angezeigt wird eine veroeffentlichte Version — dann ist sie auch die zuletzt veroeffentlichte.",
        });
      }
      return;
    }

    // state === "draft"
    if (fenster.publishedVersionId === fenster.sourceVersion.id) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceVersion"],
        message: "Dieselbe Id kann nicht gleichzeitig Entwurf und veroeffentlicht sein.",
      });
    }
  });

export type PlanningWindow = z.infer<typeof PlanningWindowSchema>;

/**
 * Der Einsatz selbst — ohne Woche.
 *
 * Eigenes Schema, weil `ValidatePlanCommand` denselben Entwurf traegt und die
 * Woche dort bereits eine Ebene hoeher steht. Sie ein zweites Mal darin zu
 * fuehren waere ein Feld, das mit sich selbst uneins sein kann.
 */
export const AssignmentDraftSchema = z.strictObject({
  employeeId: IdSchema,
  worksiteId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type AssignmentDraftDto = z.infer<typeof AssignmentDraftSchema>;

export const CreateAssignmentCommandSchema = z.strictObject({
  /**
   * Die Woche, die die Planerin GEOEFFNET hat.
   *
   * Redundant zum Intervall — und genau darum steht sie hier. Die Woche eines
   * Einsatzes ergibt sich aus seinem Beginn in der Zone der Organisation; der
   * Server rechnet sie selbst aus und vergleicht. Weichen beide ab, hat die
   * Planerin ein Datum ausserhalb der offenen Woche erwischt, und der Einsatz
   * waere in einer Woche gelandet, die sie gar nicht ansieht. Ohne dieses Feld
   * gaebe es dafuer keine Meldung, sondern nur eine Zuweisung, die nach dem
   * Speichern spurlos verschwindet.
   *
   * Es ist ausdruecklich KEINE Mandanten- oder Berechtigungsangabe: der Server
   * uebernimmt daraus nichts, er prueft nur auf Uebereinstimmung.
   */
  weekKey: IsoWeekKeySchema,
  employeeId: IdSchema,
  worksiteId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type CreateAssignmentCommand = z.infer<typeof CreateAssignmentCommandSchema>;

export const ValidatePlanCommandSchema = z.strictObject({
  weekKey: IsoWeekKeySchema,
  draft: AssignmentDraftSchema,
});

export type ValidatePlanCommand = z.infer<typeof ValidatePlanCommandSchema>;

export const PlanValidationResultSchema = z.strictObject({
  conflicts: z.array(PlanningConflictDtoSchema),
  /** Abgeleitet, aber mitgeliefert: der Client soll `blocking` nicht selbst falten. */
  publishable: z.boolean(),
});

export type PlanValidationResult = z.infer<typeof PlanValidationResultSchema>;

/**
 * Veröffentlichungskommando.
 *
 * `expectedVersionId` ist die Stale-Version-Erkennung: der Client sagt, auf
 * welchem Stand er arbeitet. Weicht der Server ab, wurde zwischenzeitlich
 * veröffentlicht und das Kommando wird abgelehnt, statt fremde Änderungen zu
 * überschreiben. `null` heisst „ich erwarte, dass noch nichts veröffentlicht ist".
 */
export const PublishPlanCommandSchema = z.strictObject({
  weekKey: IsoWeekKeySchema,
  expectedVersionId: IdSchema.nullable(),
});

export type PublishPlanCommand = z.infer<typeof PublishPlanCommandSchema>;

export const PublishedPlanVersionSchema = z.strictObject({
  versionId: IdSchema,
  weekKey: IsoWeekKeySchema,
  publishedAtUtc: InstantSchema,
  assignmentIds: z.array(IdSchema),
});

export type PublishedPlanVersion = z.infer<typeof PublishedPlanVersionSchema>;

/**
 * Einen Baustellentag anlegen (EYT-147 M2).
 *
 * Adressiert wird die Baustelle und der lokale Tag — nicht eine Id, denn die
 * gibt es noch nicht. Der Server loest daraus die Identitaet auf (anlegen oder
 * finden) und haengt sie an die Konfiguration des Wochenentwurfs. Welche
 * Planversion das ist, entscheidet ausschliesslich er ueber
 * `app.lock_week_draft(weekKey)` (Confluence 41484289 §5); ein Kommando, das
 * die Revision mitbraechte, koennte ihr widersprechen.
 *
 * `weekKey` ist dieselbe Redundanz wie bei {@link CreateAssignmentCommandSchema}:
 * die Woche, die die Planerin GEOEFFNET hat. Der Server rechnet sie aus
 * `localDate` in der Zone der Organisation selbst aus und vergleicht. Ohne das
 * Feld landete ein Tag am Wochenrand still in einer Woche, die niemand ansieht.
 */
export const PlanWorksiteDayCommandSchema = z.strictObject({
  weekKey: IsoWeekKeySchema,
  worksiteId: IdSchema,
  localDate: LocalDateSchema,
  team: WorksiteDayTeamCommandSchema,
});

export type PlanWorksiteDayCommand = z.infer<typeof PlanWorksiteDayCommandSchema>;

/**
 * Die Tagesbesetzung eines bestehenden Baustellentags ersetzen (EYT-147 M2).
 *
 * ## Was hier bewusst FEHLT
 *
 * Kein `configurationId` und kein `localDate`. Beide waeren stille
 * Zweitwahrheiten: die Revision ist durch `weekKey` eindeutig — hoechstens ein
 * unveroeffentlichter Entwurf je Woche (Confluence 41484289 §4) —, und der Tag
 * haengt unveraenderlich an der Identitaet. Ein Kommando, das sie mitschickte,
 * koennte ihnen widersprechen — und dann muesste jemand entscheiden, welche
 * Angabe gewinnt. Diese Entscheidung gibt es hier nicht, weil die Frage nicht
 * gestellt werden kann.
 *
 * Adressiert wird deshalb die STABILE `worksiteDayId`. Sie ueberlebt
 * Draft -> Publish -> Folgedraft; eine Konfigurations-Id waere nach der
 * naechsten Veroeffentlichung ins Leere gelaufen, obwohl sich am Tag nichts
 * geaendert hat.
 *
 * `expectedLockVersion` ist die Stale-Erkennung, dieselbe Bauart wie
 * `expectedVersionId` beim Veroeffentlichen: der Client sagt, auf welchem Stand
 * er arbeitet. `lock_version` ist das Nebenlaeufigkeits-Token der
 * TAGESIDENTITAET, wird beim Kopieren in den Folgedraft uebernommen und nur
 * durch eine reale Tagesmutation erhoeht (Migration 0019, R-20: "genau EINE
 * Stale-Wahrheit je Tag"). Weicht der Server ab, hat jemand anders den Tag
 * zwischenzeitlich umgeplant, und das Kommando wird abgelehnt, statt fremde
 * Arbeit zu ueberschreiben.
 */
export const UpdateWorksiteDayTeamCommandSchema = z.strictObject({
  weekKey: IsoWeekKeySchema,
  worksiteDayId: IdSchema,
  expectedLockVersion: z.number().int().min(0),
  team: WorksiteDayTeamCommandSchema,
});

export type UpdateWorksiteDayTeamCommand = z.infer<typeof UpdateWorksiteDayTeamCommandSchema>;

/**
 * Die Problem-Types der Tagescommands — das VOKABULAR, nicht die Implementierung.
 *
 * Sie stehen hier, weil sie Teil des Transportvertrags sind: ein Client
 * unterscheidet daran, ob er neu laden (`STALE_WORKSITE_DAY`), den Tag suchen
 * (`WORKSITE_DAY_NOT_FOUND`) oder die Eingabe korrigieren muss. Die
 * Zuordnung Domainfehler -> URN gehoert dagegen an die HTTP-Naht in `apps/api`
 * (`PLANNING_ERROR_TYPE` in `planning-problem.filter.ts`) und entsteht mit der
 * Businesslogik (M3/M4) — die dort diese Konstante IMPORTIERT, damit die URNs
 * nicht an zwei Stellen stehen.
 *
 * Damit diese Liste kein blosser Kommentar bleibt, werden die ERREICHBAREN
 * 409-Werte in die 409-Beschreibung der beiden Routen eingesetzt
 * (`openapi/document.ts`) und sind dadurch Teil des erzeugten `v1.json` — der
 * Drift-Test schuetzt sie byteweise mit.
 *
 * ## `WORKSITE_DAY_TEAM_REQUIRED` ist KEIN 409 dieser Routen
 *
 * Die Konstante bleibt, der veroeffentlichte 409-Zweig nicht (PO-Review 15164).
 * `WorksiteDayTeamCommandSchema.min(1)` lehnt ein leeres Team schon an der
 * Request-Grenze ab, und der Planungscontroller beantwortet einen
 * fehlgeschlagenen `safeParse` ausnahmslos mit **400** (`BadRequestException`,
 * `planning.controller.ts`) — nach erfolgreicher Schemapruefung kann der Fall
 * nicht mehr entstehen. Ein veroeffentlichter 409 dafuer waere ein Versprechen
 * an Clients, das der Server nie einloest.
 *
 * Der Wert selbst bleibt benannt, weil M3/M4 ihn an der 400-Grenze als
 * `problem.type` fuehren sollen: „Team fehlt" ist fachlich etwas anderes als
 * `INVALID_INTERVAL`, und ein Client soll beides unterscheiden koennen, ohne
 * den deutschen Meldungstext zu lesen.
 *
 * NICHT enthalten: `WORKSITE_DAY_INCOMPLETE`. Das ist ein
 * VEROEFFENTLICHUNGS-Problem und gehoert weder hierher noch in
 * {@link CONFLICT_CODE_VALUES} — ein unvollstaendiger Tag ist beim Lesen und
 * Bearbeiten voellig in Ordnung und wird erst beim Publish zum Hindernis (M5).
 */
export const WORKSITE_DAY_PROBLEM_TYPE = {
  /** Die genannte `worksiteDayId` gibt es in dieser Organisation nicht. */
  WORKSITE_DAY_NOT_FOUND: "urn:easytree:planning:worksite-day-not-found",
  /** `expectedLockVersion` passt nicht: der Tag wurde zwischenzeitlich umgeplant. */
  STALE_WORKSITE_DAY: "urn:easytree:planning:stale-worksite-day",
  /** Fuer diese Baustelle und diesen Tag existiert bereits ein Baustellentag. */
  DUPLICATE_WORKSITE_DAY: "urn:easytree:planning:duplicate-worksite-day",
  /** Ein Intervall liegt ausserhalb des lokalen Tages, den es besetzen soll. */
  INTERVAL_OUTSIDE_DAY: "urn:easytree:planning:interval-outside-day",
  /**
   * Das Kommando kam ohne Team an; ein leerer Tag entsteht nicht still.
   *
   * Request-Grenze, also **400** — nicht Teil der 409-Zweige der beiden Routen
   * (siehe Kopfkommentar). `team.min(1)` faengt den Fall vorher ab.
   */
  WORKSITE_DAY_TEAM_REQUIRED: "urn:easytree:planning:worksite-day-team-required",
} as const;

export type WorksiteDayProblemType =
  (typeof WORKSITE_DAY_PROBLEM_TYPE)[keyof typeof WORKSITE_DAY_PROBLEM_TYPE];
