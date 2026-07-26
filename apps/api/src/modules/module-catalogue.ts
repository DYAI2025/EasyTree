/**
 * Modulkatalog und Tabellenbesitz (EYT-46).
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
 * Quelle ist ADR-001 Z. 60 (der bindende Architekturvertrag). Dessen Einträge
 * sind Prosa mit Schrägstrichen und deshalb keine gültigen Verzeichnisnamen;
 * hier stehen die daraus abgeleiteten, eindeutigen Slugs:
 *
 * | ADR-001 Z. 60        | Slug             |
 * | -------------------- | ---------------- |
 * | Tenancy/Identity     | `tenancy`        |
 * | Workforce            | `workforce`      |
 * | Sites/Work           | `worksites`      |
 * | Planning             | `planning`       |
 * | Resources            | `resources`      |
 * | Timekeeping          | `timekeeping`    |
 * | Communications       | `communications` |
 * | Weather/Routing      | `weather`        |
 * | Files                | `files`          |
 * | Audit/Integration    | `audit`          |
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
 * Tabellen, die HEUTE in `supabase/migrations/` existieren.
 *
 * Vollständig gegen `20260723214800_0001_foundation.sql` und
 * `20260723222457_0002_tenancy.sql` geprüft. Das Fachschema kommt mit EYT-86;
 * bis dahin besitzt kein Fachmodul eine Tabelle — das ist der ehrliche Stand,
 * nicht eine Lücke im Register.
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
];
