/**
 * `PrimaryAction` — `busy` statt `disabled` fuer „laeuft gerade" (EYT-160).
 *
 * Drei Aufrufer in `apps/web` bauen denselben Zustand von Hand:
 * `login-form.tsx:83`, `planning-publish-action.tsx:237`,
 * `rate-management.tsx:337` — `disabled={laeuft}` plus Beschriftungswechsel
 * (gemessen 05.09.2026). `disabled` nimmt den Button aus der Tabfolge und
 * wirft den Tastaturfokus auf `body`; wer mit Enter abgeschickt hat, steht
 * danach nirgends. `busy` sagt dasselbe ueber `aria-busy` und
 * `aria-disabled`, verschluckt Klicks (und damit das Absenden eines
 * Formulars) und laesst das `disabled`-Attribut weg — der Fokus bleibt, weil
 * der Browser ihn nur bei `disabled` nimmt. Die Beschriftung bleibt Sache des
 * Aufrufers (`children`).
 *
 * Nicht behauptet: dass jsdom den Fokus bei `disabled` verliert (tut es nicht
 * zuverlaessig). Gehalten wird deshalb das ATTRIBUT, nicht der Fokus — ein
 * `disabled={busy}` faellt an „aber NICHT disabled".
 *
 * Abwesenheit ist byte-gleich: ohne `busy` traegt der Button KEIN `aria-busy`
 * und kein `aria-disabled` — die bestehenden Aufrufer bekommen exakt den DOM
 * von vorher. Ein `aria-busy="false"` als Vorgabe faellt hier.
 *
 * Gegenmutationen (ausgefuehrt 05.09.2026, siehe Commit):
 * 1. Klick-Sperre entfernen (`onClick?.(ereignis)` immer) → „ruft onClick
 *    nicht auf" und „verhindert das Absenden" rot.
 * 2. `disabled={laeuft}` zusaetzlich setzen → „aber NICHT disabled" rot.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrimaryAction } from "../src/index.js";

afterEach(cleanup);

function knopf(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

describe("PrimaryAction — busy", () => {
  it("setzt aria-busy und aria-disabled, aber NICHT disabled", () => {
    render(<PrimaryAction busy>Wird gespeichert …</PrimaryAction>);
    const b = knopf("Wird gespeichert …");
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.disabled).toBe(false);
    expect(b.hasAttribute("disabled")).toBe(false);
  });

  it("ruft onClick nicht auf, solange busy", () => {
    const onClick = vi.fn();
    render(
      <PrimaryAction busy onClick={onClick}>
        Speichern
      </PrimaryAction>,
    );
    knopf("Speichern").click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("ruft onClick auf, wenn nicht busy — die Sperre ist keine Daueranlage", () => {
    const onClick = vi.fn();
    render(<PrimaryAction onClick={onClick}>Speichern</PrimaryAction>);
    knopf("Speichern").click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("verhindert das Absenden eines Formulars, solange busy (type=submit)", () => {
    const onSubmit = vi.fn((ereignis: FormEvent<HTMLFormElement>) => ereignis.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PrimaryAction type="submit" busy>
          Senden
        </PrimaryAction>
      </form>,
    );
    // jsdom loest auf den Klick eines submit-Buttons das submit-Ereignis aus
    // und respektiert preventDefault auf dem Klick (Sonde 05.09.2026:
    // clicks=1 submits=1 ohne, submits=0 mit preventDefault).
    knopf("Senden").click();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("laesst ein Formular absenden, wenn nicht busy", () => {
    const onSubmit = vi.fn((ereignis: FormEvent<HTMLFormElement>) => ereignis.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PrimaryAction type="submit">Senden</PrimaryAction>
      </form>,
    );
    knopf("Senden").click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("traegt ohne busy weder aria-busy noch aria-disabled — der bisherige DOM bleibt", () => {
    render(<PrimaryAction>Speichern</PrimaryAction>);
    const b = knopf("Speichern");
    expect(b.hasAttribute("aria-busy")).toBe(false);
    expect(b.hasAttribute("aria-disabled")).toBe(false);
    expect(b.hasAttribute("data-busy")).toBe(false);
  });

  it("bleibt bei busy ein fokussierbarer, tab-erreichbarer Button", () => {
    render(<PrimaryAction busy>Wird gespeichert …</PrimaryAction>);
    const b = knopf("Wird gespeichert …");
    expect(b.tabIndex).toBe(0);
    b.focus();
    expect(document.activeElement).toBe(b);
  });
});
