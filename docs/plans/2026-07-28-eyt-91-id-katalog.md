# Eingefrorener ID-Katalog (EYT-91)

Stand 2026-07-28. Diese Werte sind **eingefroren**: keine Laufzeitgenerierung in Seed
oder Tests. Wer eine Fixture-ID braucht, nimmt sie hier heraus.

## Abbildungsregel

Alle 28 Alt-IDs hatten die Form `00000000-0000-0000-0000-<12 hex>` — Gruppen 1 bis 4
durchgehend null, die gesamte Bedeutung in Gruppe 5. Die Abbildung ist deshalb **eine
Regel**, nicht 28 Einzelentscheidungen:

```
00000000-0000-0000-0000-<X>   ->   00000000-0000-4000-8000-<X>
                 ^    ^                          ^    ^
                 |    |                          |    +-- Variante 8 (RFC-konform)
                 |    +-- Variante 0             +-- Version 4
                 +-- Version 0 (vertragswidrig)
```

Warum strukturiert statt zufaellig: die Kodierung ist lesbar — die Zifferngruppe nennt
den Entitaetstyp, das Suffix `a1`/`b2` die Organisation. Zufallswerte haetten sie
zerstoert und jeden Diff unlesbar gemacht. Gemessen erfuellen die strukturierten Werte
`IdSchema` genauso wie `crypto.randomUUID()`; die Anforderung lautet Version 4 plus
gueltige Variante, nicht Entropie. Fuer deterministische Fixtures ist Zufall ohnehin
ein Nachteil.

## Nicht im Katalog: die Nil-UUID

`00000000-0000-0000-0000-000000000000` bleibt an ihren drei Stellen unveraendert. Sie
ist ausschliesslich `auth.users.instance_id` — GoTrues eigener Sentinel fuer "keine
Instanz", in einer Spalte, die uns nicht gehoert, die keine Route liest und die kein
Vertrag validiert. Eine erfundene v4 waere dort eine Abweichung vom Fremdsystem, kein
Fix. `IdSchema` akzeptiert die Nil-UUID ohnehin (RFC 9562).

## Katalog

| Bedeutung                                   | Definierende Tabelle/Datei                         | Rolle                                          | Alt                  | Neu                                    | Vork. |
| ------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- | -------------------- | -------------------------------------- | ----: |
| Organisation Alpha                          | `public.organizations`                             | PK; org_id-FK in fast allen Tabellen           | `…0000000000a1` (v0) | `00000000-0000-4000-8000-0000000000a1` |    49 |
| Organisation Beta                           | `public.organizations`                             | PK; org_id-FK; Fremdtenant in Isolationstests  | `…0000000000b2` (v0) | `00000000-0000-4000-8000-0000000000b2` |    35 |
| Baustellen-Konstante SITE (reiner Unittest) | `apps/api/test/planning-conflict.test.ts`          | Konstante; kein DB-Bezug                       | `…0000000011c1` (v0) | `00000000-0000-4000-8000-0000000011c1` |     1 |
| User A (Alpha, aktiv)                       | `auth.users / public.users`                        | PK; FK memberships.user_id, auth.uid()-Subjekt | `…00000000aaa1` (v0) | `00000000-0000-4000-8000-00000000aaa1` |    29 |
| User B (Beta)                               | `auth.users / public.users`                        | PK; FK memberships.user_id                     | `…00000000bbb2` (v0) | `00000000-0000-4000-8000-00000000bbb2` |     8 |
| User C (Alpha, inaktive Mitgliedschaft)     | `auth.users / public.users`                        | PK; FK memberships.user_id                     | `…00000000ccc3` (v0) | `00000000-0000-4000-8000-00000000ccc3` |     6 |
| Item Alpha                                  | `public.items`                                     | PK; FK item_notes.item_id                      | `…0000000110a1` (v0) | `00000000-0000-4000-8000-0000000110a1` |     3 |
| Item Beta                                   | `public.items`                                     | PK; FK item_notes.item_id                      | `…0000000220b2` (v0) | `00000000-0000-4000-8000-0000000220b2` |     5 |
| Item-Notiz Alpha                            | `public.item_notes`                                | PK                                             | `…0000000310a1` (v0) | `00000000-0000-4000-8000-0000000310a1` |     1 |
| Item-Notiz Beta                             | `public.item_notes`                                | PK                                             | `…0000000320b2` (v0) | `00000000-0000-4000-8000-0000000320b2` |     2 |
| Mitgliedschaft A                            | `public.memberships`                               | PK                                             | `…0000000e0aa1` (v0) | `00000000-0000-4000-8000-0000000e0aa1` |     1 |
| Mitgliedschaft B                            | `public.memberships`                               | PK                                             | `…0000000e0bb2` (v0) | `00000000-0000-4000-8000-0000000e0bb2` |     1 |
| Mitgliedschaft C (inaktiv)                  | `public.memberships`                               | PK                                             | `…0000000e0cc3` (v0) | `00000000-0000-4000-8000-0000000e0cc3` |     1 |
| Beschaeftigte Alpha 1                       | `public.employees`                                 | PK; FK assignments.employee_id                 | `…0000004010a1` (v0) | `00000000-0000-4000-8000-0000004010a1` |     8 |
| Beschaeftigte Alpha 2                       | `public.employees`                                 | PK; FK assignments.employee_id                 | `…0000004011a1` (v0) | `00000000-0000-4000-8000-0000004011a1` |     2 |
| Beschaeftigte Beta                          | `public.employees`                                 | PK; FK assignments.employee_id                 | `…0000004020b2` (v0) | `00000000-0000-4000-8000-0000004020b2` |     2 |
| Baustelle Alpha                             | `public.worksites`                                 | PK; FK assignments.worksite_id                 | `…0000005010a1` (v0) | `00000000-0000-4000-8000-0000005010a1` |     8 |
| Baustelle Beta                              | `public.worksites`                                 | PK; FK assignments.worksite_id                 | `…0000005020b2` (v0) | `00000000-0000-4000-8000-0000005020b2` |     2 |
| Planversion Alpha                           | `public.plan_versions`                             | PK; FK assignments.plan_version_id             | `…0000006010a1` (v0) | `00000000-0000-4000-8000-0000006010a1` |     9 |
| Planversion Beta                            | `public.plan_versions`                             | PK; FK assignments.plan_version_id             | `…0000006020b2` (v0) | `00000000-0000-4000-8000-0000006020b2` |     2 |
| Planversion, pgTAP-lokal                    | `supabase/tests/0006_planning_invariants.sql`      | PK, testlokal                                  | `…0000006099a1` (v0) | `00000000-0000-4000-8000-0000006099a1` |     4 |
| Planversion, pgTAP-lokal                    | `supabase/tests/0007_temporal_and_idempotency.sql` | PK, testlokal                                  | `…0000006143a1` (v0) | `00000000-0000-4000-8000-0000006143a1` |     3 |
| Planversion, pgTAP-lokal                    | `supabase/tests/0007_temporal_and_idempotency.sql` | PK, testlokal                                  | `…0000006144a1` (v0) | `00000000-0000-4000-8000-0000006144a1` |     5 |
| Zuweisung Alpha                             | `public.assignments`                               | PK                                             | `…0000007010a1` (v0) | `00000000-0000-4000-8000-0000007010a1` |     3 |
| Zuweisung Beta                              | `public.assignments`                               | PK                                             | `…0000007020b2` (v0) | `00000000-0000-4000-8000-0000007020b2` |     1 |
| Zuweisung, pgTAP-lokal                      | `supabase/tests/0006_planning_invariants.sql`      | PK, testlokal                                  | `…0000007099a1` (v0) | `00000000-0000-4000-8000-0000007099a1` |     2 |
| Zuweisung, pgTAP-lokal                      | `supabase/tests/0007_temporal_and_idempotency.sql` | PK, testlokal                                  | `…0000007143a1` (v0) | `00000000-0000-4000-8000-0000007143a1` |     1 |
| Zuweisung, pgTAP-lokal                      | `supabase/tests/0007_temporal_and_idempotency.sql` | PK, testlokal                                  | `…0000007144a1` (v0) | `00000000-0000-4000-8000-0000007144a1` |     2 |

28 Eintraege, 196 Vorkommen. Zielwerte maschinell auf Eindeutigkeit geprueft.
Alt-Werte stehen verkuerzt, weil alle denselben Praefix `00000000-0000-0000-0000-` trugen.

## Referenzierende Dateien

- `apps/api/test/planning-conflict.test.ts`
- `apps/api/test/planning-invariants.integration.test.ts`
- `apps/api/test/planning-window.http.test.ts`
- `apps/api/test/tenant-context.helper.ts`
- `apps/api/test/tenant-query-runner-lifecycle.test.ts`
- `apps/api/test/tenant-subject.test.ts`
- `apps/web/e2e/harness/seed.sql`
- `apps/web/e2e/harness/verify-seed.sql`
- `supabase/seed.sql`
- `supabase/tests/0002_rls_isolation.sql`
- `supabase/tests/0004_core_domain.sql`
- `supabase/tests/0006_planning_invariants.sql`
- `supabase/tests/0007_temporal_and_idempotency.sql`

## Nachweis

`apps/api/test/seed-contract-ids.test.ts` prueft dauerhaft, dass jede ID in
`supabase/seed.sql` `IdSchema` besteht, dass eine geseedete `employeeId` und eine
`worksiteId` den Vertrag passieren und dass die Nil-UUID nur als `instance_id`
vorkommt. Gegenmutation ausgefuehrt: eine einzelne ID zurueck auf Versions-Nibble `0`
macht den Test rot und nennt die betroffene ID.
