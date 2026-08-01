/**
 * Modulkatalog und Tabellenbesitz (EYT-46, erweitert um `costs` in EYT-105).
 *
 * ## Was diese Datei ist
 *
 * Die eine eingefrorene Namensliste der Fachmodule. Verzeichnisname, Eintrag in
 * `MODULE_SLUGS` und jeder Typparameter sind derselbe String — genau deshalb
 * existiert die Liste. Sie ist die Nicht-Leerlauf-Bremse des Architekturtests:
 * `SCAFFOLDED_MODULES` verlangt für jedes genannte Modul echte Dateien, statt
 * eine Metrik über zufällig gefundene Dateien zu zählen.
 *
 * ## Was diese Datei NICHT ist
 *
 * **Tabellenbesitz ist zur Laufzeit NICHT erzwungen.** Es gibt in
 * `supabase/migrations/` genau eine Anwendungsrolle (`authenticated`), und die
 * Grants in `20260723222457_0002_tenancy.sql` gelten für alle schreibbaren
 * Tabellen. RLS filtert nach Mandant (`app.user_org_ids()`), nicht nach Modul.
 * Jeder Modulcode kann also innerhalb seines Mandanten jede Tabelle schreiben,
 * und PostgreSQL nimmt das an.
 *
 * ADR-001 Z. 75 („Ein Modul schreibt nur seine eigenen Tabellen") ist damit
 * heute eine **Reviewkonvention plus dieser Registereintrag**, keine Invariante.
 * ADR-001 Z. 78 („Dependency- und Tabellenbesitzregeln werden in CI geprüft")
 * gilt für die Dependency-Hälfte; die Tabellenbesitz-Hälfte ist offen und darf
 * nicht als erfüllt gemeldet werden. Eine echte Durchsetzung bräuchte je Modul
 * eine eigene Datenbankrolle mit eigenen Grants — das gehört zu EYT-86 und ist
 * dort zu entscheiden.
 */

/**
 * Eingefrorene Modul-Slugs.
 *
 * **Zwei Quellen, nicht eine.** Die ersten zehn Slugs sind aus ADR-001 Z. 60
 * abgeleitet; der elfte (`costs`) kommt aus ADR-003, das die Modulliste aus
 * ADR-001 ausdrücklich **erweitert** (EYT-105 AC 1). Diese Unterscheidung steht
 * hier, weil die pauschale Angabe „abgeleitet aus ADR-001 Z. 60" mit `costs`
 * schlicht falsch wäre: ADR-001 Z. 60 kennt kein Kostenmodul.
 *
 * Die Einträge von ADR-001 Z. 60 sind Prosa mit Schrägstrichen und deshalb
 * keine gültigen Verzeichnisnamen; hier stehen die daraus abgeleiteten,
 * eindeutigen Slugs:
 *
 * | Quelle            | Eintrag           | Slug             |
 * | ----------------- | ----------------- | ---------------- |
 * | ADR-001 Z. 60     | Tenancy/Identity  | `tenancy`        |
 * | ADR-001 Z. 60     | Workforce         | `workforce`      |
 * | ADR-001 Z. 60     | Sites/Work        | `worksites`      |
 * | ADR-001 Z. 60     | Planning          | `planning`       |
 * | ADR-001 Z. 60     | Resources         | `resources`      |
 * | ADR-001 Z. 60     | Timekeeping       | `timekeeping`    |
 * | ADR-001 Z. 60     | Communications    | `communications` |
 * | ADR-001 Z. 60     | Weather/Routing   | `weather`        |
 * | ADR-001 Z. 60     | Files             | `files`          |
 * | ADR-001 Z. 60     | Audit/Integration | `audit`          |
 * | ADR-003 §1        | Costs             | `costs`          |
 *
 * Eingefroren heißt weiterhin: eine weitere Zeile ist eine Architekturänderung
 * mit ADR-Pflicht, kein Detail. `architecture.test.ts` prüft für `costs`
 * namentlich, dass eine ADR unter `docs/architecture/` den Slug zusammen mit
 * EYT-105 nennt.
 *
 * Abweichung zur Analyse: `docs/audit/INTEGRATION_ARCHITECTURE.md` nennt in der
 * Zielstruktur zusätzlich ein Verzeichnis `absence` und verwendet `time` statt
 * `timekeeping` sowie `notifications` statt `communications`. ADR-001 ist der
 * bindende Vertrag und gewinnt; `absence` wird NICHT vorsorglich angelegt,
 * sondern von dem Ticket entschieden, das Abwesenheiten modelliert (EYT-86
 * führt `AbsenceRequest`/`AbsenceDecision`).
 */
export const MODULE_SLUGS = [
  "tenancy",
  "workforce",
  "worksites",
  "planning",
  "resources",
  "timekeeping",
  "communications",
  "weather",
  "files",
  "audit",
  // ADR-003 (EYT-105) — Erweiterung der Liste aus ADR-001 Z. 60.
  "costs",
] as const;

export type ModuleSlug = (typeof MODULE_SLUGS)[number];

/**
 * Module, die HEUTE Code besitzen und deren Grenzen der Architekturtest deshalb
 * tatsächlich prüfen kann.
 *
 * Bewusst kurz: leere Modulverzeichnisse sind keine Grenzen, sondern
 * Scheinkapselung mit grünem Haken — ADR-001 Z. 33 benennt genau diese Gefahr.
 * Ein Modul wird hier eingetragen, wenn das Ticket es braucht, das seinen Code
 * schreibt. Der Eintrag ist eine Zusage: der Test verlangt danach echte Dateien
 * in `domain/` und `application/` sowie eine `index.ts`.
 */
export const SCAFFOLDED_MODULES = [
  "workforce",
  "worksites",
  "planning",
  // EYT-105: vier gefüllte Schichten plus schmale index.ts. Der Eintrag ist die
  // Zusage, dass `costs-module-boundaries.test.ts` echte Dateien vorfindet —
  // ohne ihn liefe `it.each([...SCAFFOLDED_MODULES])` am Modul vorbei.
  "costs",
  // EYT-106: Identitaet, Mitgliedschaft, Anmeldung — der Auth-Slice.
  "tenancy",
] as const satisfies readonly ModuleSlug[];

/** Schichten je Modul. Reihenfolge = erlaubte Importrichtung (aussen darf nach innen). */
export const MODULE_LAYERS = ["domain", "application", "infrastructure", "interface"] as const;

export type ModuleLayer = (typeof MODULE_LAYERS)[number];

export interface TableOwnership {
  /** Tabellenname exakt wie in der Migration, inkl. Schema. */
  readonly table: string;
  /** Besitzendes Modul, oder `null` fuer globale/identitaetsnahe Tabellen. */
  readonly owner: ModuleSlug | null;
  /** true => traegt `org_id NOT NULL` (ADR-001 Z. 82, dort `organization_id` genannt). */
  readonly tenantOwned: boolean;
  readonly note: string;
}

/**
 * Besitzregister der Tabellen.
 *
 * Alle Einträge bis einschließlich `public.outbox_messages` existieren HEUTE in
 * `supabase/migrations/`, vollständig gegen die dortigen Dateien geprüft.
 *
 * **Ausnahme, benannt statt versteckt:** die drei `cost_*`-Einträge am Ende
 * haben noch KEINE Migration. Sie stehen hier, weil EYT-105 AC 1 die
 * Registrierung des Tabellenbesitzes zusammen mit ADR, `MODULE_SLUGS` und
 * `SCAFFOLDED_MODULES` verlangt und ADR-003 §2 den Besitz entscheidet — das
 * Schema selbst gehört zu EYT-108 (Sätze) und EYT-109 (Snapshot). Wer dort
 * einen anderen Tabellennamen wählt, ändert damit ADR-003 und muss diesen
 * Eintrag mitziehen; ein stiller Namensdrift wäre ein Register, das nichts mehr
 * beschreibt. Bis dahin ist `false` hier keine Option: Kostendaten sind
 * mandantengebunden (ADR-001 Z. 82), und das ist die Vorgabe an die Migration,
 * nicht ein Bericht über sie.
 */
export const TABLE_OWNERSHIP: readonly TableOwnership[] = [
  {
    table: "public.organizations",
    owner: "tenancy",
    tenantOwned: false,
    note: "Ist selbst der Mandant und traegt daher naturgemaess kein org_id.",
  },
  {
    table: "public.users",
    owner: "tenancy",
    tenantOwned: false,
    note: "1:1 auf auth.users, RLS nur self. Zuordnung zur Organisation ausschliesslich ueber memberships.",
  },
  {
    table: "public.memberships",
    owner: "tenancy",
    tenantOwned: true,
    note: "Verbindet User und Organization inkl. Rolle und Aktiv-Flag.",
  },
  {
    table: "public.items",
    owner: null,
    tenantOwned: true,
    note: "Synthetische RLS-Beweistabelle aus 0002_tenancy.sql, kein Fachbestand.",
  },
  {
    table: "public.item_notes",
    owner: null,
    tenantOwned: true,
    note: "Synthetische RLS-Beweistabelle aus 0002_tenancy.sql, kein Fachbestand.",
  },
  {
    table: "public.employees",
    owner: "workforce",
    tenantOwned: true,
    note: "Beschaeftigte je Organisation (0005). PERSONENBEZOGEN. user_id ist optional, deshalb eigenstaendiges org_id. KEIN delete-Grant: Deaktivierung ueber active, Loeschen auf Betroffenenverlangen braucht einen eigenen Pfad (EYT-14).",
  },
  {
    table: "public.worksites",
    owner: "worksites",
    tenantOwned: true,
    note: "Baustellen je Organisation (0006). Adresse, Treffpunkt und Taetigkeiten folgen mit EYT-16.",
  },
  {
    table: "public.plan_versions",
    owner: "planning",
    tenantOwned: true,
    note: "Planversion je Organisation und ISO-Woche (0007). published_at ist die autoritative Veroeffentlichungsmarke.",
  },
  {
    table: "public.assignments",
    owner: "planning",
    tenantOwned: true,
    note: "Zuweisungen (0007). PERSONENBEZOGEN. Tenantgebundene FKs auf employees und worksites; published_at ist der lokal pruefbare Marker fuer EYT-49.",
  },
  {
    table: "public.audit_events",
    owner: "audit",
    tenantOwned: true,
    note: "Anfuegbare Auditspur (0008). Kein update/delete-Grant, und die Policy bindet actor_user_id an app.current_user_id() — Anfuegbarkeit UND Zuschreibung sind Rechte, keine Konvention.",
  },
  {
    table: "public.outbox_messages",
    owner: "audit",
    tenantOwned: true,
    note: "Transactional Outbox (0008). Zustellstrecke fehlt noch und hat kein Ticket (Sprintplan L-12).",
  },
  {
    // Heisst in Migration 0013 `employee_rate_versions`, nicht
    // `cost_rate_versions` wie ADR-003 §2 vorlaeufig notierte: der Name im ADR
    // stand fest, bevor es die Tabelle gab, und das Praefix `cost_` waere
    // doppelt gemoppelt (sie liegt ohnehin im Kostenmodul) sowie ungenauer —
    // versioniert werden MITARBEITER-Saetze. Der Besitz ist unveraendert.
    table: "public.employee_rate_versions",
    owner: "costs",
    tenantOwned: true,
    note: "Append-only versionierte Mitarbeiter-Stundensaetze in EUR-Minor-Units mit halboffenem Effective-Date-Intervall (0013, EYT-108). PERSONENBEZOGEN (Entgeltdaten). Ueberlappung per EXCLUDE ausgeschlossen; select verlangt costs.read, insert costs.manage_rates.",
  },
  {
    table: "public.role_permissions",
    owner: "tenancy",
    tenantOwned: false,
    note: "Produktweite Zuordnung Rolle -> atomares Recht (0013, EYT-106). Bewusst OHNE org_id: Produkteigenschaft, kein Kundendatum. Anwendungsrollen haben nur select; Aenderungen ausschliesslich ueber Migrationen.",
  },
  {
    table: "public.cost_snapshots",
    owner: "costs",
    tenantOwned: true,
    note: "MIGRATION FEHLT NOCH — Besitz von ADR-003 §2 entschieden, Schema gehoert zu EYT-109. Unveraenderlicher Tageskosten-Snapshot je veroeffentlichter Planversion.",
  },
  {
    table: "public.cost_snapshot_items",
    owner: "costs",
    tenantOwned: true,
    note: "MIGRATION FEHLT NOCH — Besitz von ADR-003 §2 entschieden, Schema gehoert zu EYT-109. Einzelpositionen des Snapshots mit Satzversion, Regelversion und gerundetem Betrag.",
  },
];
