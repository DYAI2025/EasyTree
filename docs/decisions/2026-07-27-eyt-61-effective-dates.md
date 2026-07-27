# EYT-61 AK6(d) „Effective Dates" — kein Testgegenstand im MVP

**Datum:** 2026-07-27
**Vorgang:** EYT-61 — Domain-, Zeit- und Idempotenzinvarianten test-first absichern
**Status:** entschieden, umgesetzt als Auslassung mit Begründung

## Worum es geht

EYT-61 AK6 verlangt wörtlich, dass „Sommerzeitlücke, doppelte Winterzeitstunde,
Mitternachtswechsel und **Effective Dates**" abgedeckt sind. Die ersten drei sind
umgesetzt (`packages/domain/test/temporal-edges.test.ts`,
`supabase/tests/0007_temporal_and_idempotency.sql`). Der vierte ist es nicht — und
zwar nicht aus Zeitmangel.

## Der Befund

Der einzige Ort im gesamten Repository, an dem das Produkt eine Gültigkeitsspanne
kennt, ist `docs/prd/CURRENT_PRD_v1.3.md:123`:

> jeder Satz besitzt `gültig ab` und optional `gültig bis`

Dieser Satz steht unter der Überschrift `docs/prd/CURRENT_PRD_v1.3.md:112`:

> ## 6. Post-MVP: Planungsökonomie und Maschinenverleih

und `docs/prd/CURRENT_PRD_v1.3.md:114` stellt ausdrücklich fest, dass dieser
Abschnitt weder Teil der MVP-Implementierung noch der MVP-Abnahme ist. `CLAUDE.md`
führt dasselbe Modul unter „Out of scope unless the user explicitly opens that
phase".

Im Code gibt es dazu nichts: keine Tabelle mit `gueltig_ab`/`valid_from`, kein
Domainmodell mit Gültigkeitsspanne, kein Feld in `packages/contracts`. Es existiert
kein MVP-Objekt, dessen Gültigkeit beginnen oder enden könnte.

## Warum das kein Testproblem ist

Ein Test braucht einen Gegenstand. Was hier möglich wäre, ist eines von zwei
Dingen, und beide sind schlechter als die Auslassung:

1. **Einen Träger erfinden**, nur damit ein Test etwas zu prüfen hat. Das wäre
   Post-MVP-Funktionalität ohne Ticket und ohne Entscheidung — genau die Sorte
   stiller Scope-Ausweitung, die `CLAUDE.md` verbietet.
2. **Einen Test schreiben, der nichts prüft**, und AK6 als erfüllt melden. Das
   wäre ein grüner Haken auf einer leeren Zusage.

## Der Widerspruch, der bestehen bleibt

`docs/plans/2026-07-26-eyt-sprint-3-integrierter-slice.md:384` fordert Effective
Dates wörtlich als Abdeckung, und `:351` nennt sie zusätzlich als Schemaregel für
EYT-48. Der Sprintplan verlangt damit etwas, das das PRD ins Post-MVP schiebt.

Dieser Widerspruch wird hier **nicht aufgelöst**, sondern festgehalten. Auflösen
kann ihn nur, wer den Scope besitzt: entweder wird ein MVP-Träger benannt (dann
bekommt EYT-61 AK6(d) einen Gegenstand und einen Test), oder AK6(d) wird aus dem
Kriterium gestrichen.

## Konsequenz für die Abnahme

**EYT-61 AK6 ist zu drei Vierteln erfüllt und darf nicht als vollständig gemeldet
werden.** Wer die Restabdeckung will, muss zuerst die Scope-Frage beantworten,
nicht einen Test nachreichen.
