import { Inject, Injectable, Optional, type OnApplicationShutdown } from "@nestjs/common";
import type { AppConfig } from "@easytree/config";

import { APP_CONFIG } from "../../config/config.module";
import { PgTenantQueryRunner } from "./tenant-query-runner";
import type { TenantQuery, TenantQueryRunner, TenantContext } from "./tenant-query-runner";

/**
 * Der Verbindungspool als Nest-Provider MIT Lebenszyklus (EYT-50).
 *
 * Zuvor entstand der Pool in einer `useFactory` und war Nest damit unbekannt:
 * `app.close()` konnte ihn nicht schliessen, und die Verbindungen blieben
 * offen. Im Prozess ist das ein Leck, in einer Testsuite ein haengender
 * Handle — und beim Shutdown-Pfad, den `enableShutdownHooks()` gerade
 * garantieren soll, eine unvollstaendige Zusage.
 */
@Injectable()
export class TenantQueryRunnerProvider implements TenantQueryRunner, OnApplicationShutdown {
  readonly #runner: PgTenantQueryRunner;
  #closed = false;

  /**
   * `runner` ist ein Einspritzpunkt fuer Tests — dieselbe Bauart wie die
   * Rollenpruefung in `main.ts`. Ohne ihn liesse sich der Lebenszyklus nur
   * gegen eine echte Datenbank pruefen, und geprueft werden soll hier der
   * Lebenszyklus, nicht Postgres.
   *
   * `@Optional()` ist Pflicht: ein optionaler TypeScript-Parameter bleibt in
   * den `design:paramtypes`-Metadaten stehen, und Nest versucht ihn sonst
   * aufzuloesen — der ganze AppModule scheitert dann beim Bauen.
   */
  constructor(@Inject(APP_CONFIG) config: AppConfig, @Optional() runner?: PgTenantQueryRunner) {
    this.#runner = runner ?? PgTenantQueryRunner.fromUrl(config.databaseUrl);
  }

  run<T>(context: TenantContext, work: (tx: TenantQuery) => Promise<T>): Promise<T> {
    return this.#runner.run(context, work);
  }

  /** Genau einmal. Ein zweiter `end()` auf demselben Pool wirft. */
  async onApplicationShutdown(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#runner.close();
  }

  /** Nur fuer Tests: wurde der Pool bereits beendet? */
  get closed(): boolean {
    return this.#closed;
  }
}

/** DI-Token: die Klasse selbst, damit Nest sie als Lifecycle-Provider kennt. */
export const TENANT_QUERY_RUNNER = TenantQueryRunnerProvider;
