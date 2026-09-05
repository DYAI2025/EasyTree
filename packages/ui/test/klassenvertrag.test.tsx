/**
 * Die EMITTER-Seite der Klassenkopplung fuer die sieben Bausteine, die sie
 * bisher nicht hatten (EYT-160).
 *
 * `app-shell.test.tsx` („gibt alle sechs Klassennamen des Rahmens aus") und
 * `date-range-control.test.tsx` („gibt alle sieben Klassennamen …") halten
 * das Muster fuer zwei Bausteine fest. Fuer StatusBadge, StateBanner,
 * LoadingState, EmptyState, ErrorState, Card und PrimaryAction hielt es
 * nichts: eine Umbenennung dort liess dieses Paket gruen (5 Dateien / 91
 * Tests, gemessen 05.09.2026), waehrend `apps/web/app/globals.css` seine
 * Regel verlor — dasselbe Loch, das am 27.08.2026 an
 * `.eyt-app-shell__footer` gemessen wurde.
 *
 * Dazu die zwei Durchreich-Zusagen, auf die `apps/web` schon baut:
 * `className` wird ANGEHAENGT, nicht ersetzt, und `data-*`-Attribute landen
 * auf dem Wurzelelement (`kosten-uebergang.tsx` haengt eine testid an `Card`,
 * `planning-publish-action.tsx` an `StateBanner`, `feld-start.tsx` an
 * `LoadingState`).
 *
 * Gegenmutation (ausgefuehrt 05.09.2026, siehe Commit): in
 * `src/state-banner.tsx` `eyt-state-banner__title` zu
 * `eyt-state-banner__titel` → „StateBanner gibt … aus" wird rot und nennt
 * `.eyt-state-banner__title`; keine andere Suite bemerkt es.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BANNER_TONES,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PrimaryAction,
  STATUS_TONES,
  StateBanner,
  StatusBadge,
} from "../src/index.js";

afterEach(cleanup);

/** Jede Klasse genau so im DOM, wie das Stylesheet der Anwendung sie erwartet. */
function erwarteKlassen(element: ReactElement, klassen: readonly string[]): void {
  const { container } = render(element);
  for (const klasse of klassen) {
    expect(
      container.querySelector(`.${klasse}`),
      `.${klasse} wird nicht mehr ausgegeben`,
    ).not.toBeNull();
  }
}

describe("Klassenvertrag — die Emitter-Seite (EYT-160)", () => {
  it("StatusBadge gibt Wurzel, Zeichen und jeden Ton aus", () => {
    for (const tone of STATUS_TONES) {
      erwarteKlassen(<StatusBadge tone={tone}>x</StatusBadge>, [
        "eyt-status-badge",
        `eyt-status-badge--${tone}`,
        "eyt-status-badge__mark",
      ]);
      cleanup();
    }
  });

  it("StateBanner gibt Wurzel, Text, Titel, Detail, Aktion und jeden Ton aus", () => {
    for (const tone of BANNER_TONES) {
      erwarteKlassen(
        <StateBanner tone={tone} title="t" action={<button type="button">a</button>}>
          d
        </StateBanner>,
        [
          "eyt-state-banner",
          `eyt-state-banner--${tone}`,
          "eyt-state-banner__text",
          "eyt-state-banner__title",
          "eyt-state-banner__detail",
          "eyt-state-banner__action",
        ],
      );
      cleanup();
    }
  });

  it("LoadingState gibt Wurzel, Zeichen und Beschriftung aus", () => {
    erwarteKlassen(<LoadingState label="l" />, [
      "eyt-loading-state",
      "eyt-loading-state__mark",
      "eyt-loading-state__label",
    ]);
  });

  it("EmptyState gibt Wurzel, Titel, Beschreibung und Aktion aus", () => {
    erwarteKlassen(
      <EmptyState title="t" description="d" action={<button type="button">a</button>} />,
      [
        "eyt-empty-state",
        "eyt-empty-state__title",
        "eyt-empty-state__description",
        "eyt-empty-state__action",
      ],
    );
  });

  it("ErrorState gibt Wurzel, Titel, Beschreibung und Wiederholen aus", () => {
    erwarteKlassen(<ErrorState title="t" description="d" onRetry={vi.fn()} />, [
      "eyt-error-state",
      "eyt-error-state__title",
      "eyt-error-state__description",
      "eyt-error-state__retry",
    ]);
  });

  it("Card gibt Wurzel und Titel aus", () => {
    erwarteKlassen(<Card title="t">k</Card>, ["eyt-card", "eyt-card__title"]);
  });

  it("PrimaryAction gibt ihre Wurzelklasse aus", () => {
    erwarteKlassen(<PrimaryAction>p</PrimaryAction>, ["eyt-primary-action"]);
  });
});

/**
 * Durchreichen: `className` haengt an, `data-*` landet auf der Wurzel.
 * Je Baustein eine Zeile in der Tabelle, damit ein Fehlschlag den NAMEN des
 * Bausteins nennt und keinen Index.
 */
describe("Durchreich-Zusagen (EYT-160)", () => {
  const FAELLE: ReadonlyArray<readonly [string, ReactElement, string]> = [
    [
      "Card",
      <Card className="zusatz" data-testid="sonde">
        k
      </Card>,
      "eyt-card",
    ],
    [
      "StateBanner",
      <StateBanner tone="info" title="t" className="zusatz" data-testid="sonde" />,
      "eyt-state-banner",
    ],
    [
      "LoadingState",
      <LoadingState label="l" className="zusatz" data-testid="sonde" />,
      "eyt-loading-state",
    ],
    [
      "EmptyState",
      <EmptyState title="t" description="d" className="zusatz" data-testid="sonde" />,
      "eyt-empty-state",
    ],
    [
      "ErrorState",
      <ErrorState title="t" description="d" className="zusatz" data-testid="sonde" />,
      "eyt-error-state",
    ],
    [
      "StatusBadge",
      <StatusBadge tone="neutral" className="zusatz" data-testid="sonde">
        s
      </StatusBadge>,
      "eyt-status-badge",
    ],
    [
      "PrimaryAction",
      <PrimaryAction className="zusatz" data-testid="sonde">
        p
      </PrimaryAction>,
      "eyt-primary-action",
    ],
  ];

  it.each(FAELLE)(
    "%s haengt className an und traegt data-testid auf der Wurzel",
    (_name, element, basis) => {
      render(element);
      const wurzel = screen.getByTestId("sonde");
      expect(wurzel.classList.contains(basis), `Basisklasse .${basis} fehlt`).toBe(true);
      expect(wurzel.classList.contains("zusatz"), "className wurde ersetzt statt angehaengt").toBe(
        true,
      );
    },
  );
});
