/**
 * Verbindungsfrische Poolattrappe fuer Cloudflare Workers (EYT-142, Naht K1).
 *
 * ## Der gemessene Zwang
 *
 * Spike A4 hat belegt, dass ein I/O-Objekt die Requestgrenze nicht ueberlebt.
 * Ein Socket aus Request 1, in Request 2 benutzt, endet mit:
 *
 *     Cannot perform I/O on behalf of a different request. I/O objects (such as
 *     streams, request/response bodies, and others) created in the context of
 *     one request handler cannot be accessed from a different request's
 *     handler. (I/O type: Writable)
 *
 * Der Kontrollfall — jeder Request oeffnet seinen EIGENEN Socket — war gruen.
 * Genau das ist der Unterschied zwischen Step 3 und Step 4 des Spikes, und
 * genau darauf beruht diese Datei.
 *
 * Ein `pg.Pool` haelt Verbindungen absichtlich offen, um sie wiederzuverwenden.
 * Auf Workers ist das kein Optimierungsdetail, sondern ein Fehler ab dem
 * ZWEITEN Request: der Bau "baut gruen" und stirbt im Betrieb.
 *
 * ## Warum eine Attrappe und keine Aenderung am Runner
 *
 * `PgTenantQueryRunner` braucht von seinem Pool strukturell nur `connect()`
 * und `end()`, und `connect()` nur ein Objekt mit `query()` und `release()`.
 * Diese Attrappe erfuellt dieselbe Form. Dadurch bleiben die
 * Transaktionsklammer (`set_config('request.jwt.claims', …, true)` →
 * `set local role authenticated` → Rumpf), die Repositories und die Domain
 * WORTGLEICH — N5 und N7 aus dem Plan sind damit nicht Absicht, sondern Folge
 * der Bauform.
 *
 * Auf Node bleibt der echte `pg.Pool` in Gebrauch; diese Datei ist der
 * Workers-Pfad und aendert am Railway-Start nichts.
 */

/** Was `PgTenantQueryRunner` von einem entliehenen Client braucht. */
export interface RequestScopedClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(err?: Error): void;
}

/** Was `PgTenantQueryRunner` von einem Pool braucht. */
export interface RequestScopedPool {
  connect(): Promise<RequestScopedClient>;
  end(): Promise<void>;
}

/** Eine frisch geoeffnete Verbindung. */
export interface FrischeVerbindung {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
}

/**
 * Baut einen Pool, der je `connect()` eine frische Verbindung oeffnet und sie
 * bei `release()` wieder schliesst.
 *
 * `end()` ist bewusst ein No-op: es gibt keinen gehaltenen Bestand, den man
 * schliessen koennte. Der Lebenszyklus liegt vollstaendig beim einzelnen
 * `run()`.
 */
export function createRequestScopedPool(
  oeffne: () => Promise<FrischeVerbindung>,
): RequestScopedPool {
  return {
    async connect(): Promise<RequestScopedClient> {
      const verbindung = await oeffne();
      return {
        query: (sql: string, params?: unknown[]) => verbindung.query(sql, params),
        release: (): void => {
          // `release` ist im pg-Vertrag synchron. Die Verbindung wird deshalb
          // im Hintergrund geschlossen; ein Fehler dabei darf den bereits
          // beantworteten Request nicht mehr umwerfen.
          void verbindung.end().catch(() => undefined);
        },
      };
    },
    end(): Promise<void> {
      return Promise.resolve();
    },
  };
}
