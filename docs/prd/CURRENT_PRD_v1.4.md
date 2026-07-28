# Arboscus Teamplaner / EasyTree – Current PRD v1.4

> **Status:** proposed current product baseline  
> **Date:** 2026-07-28  
> **Supersedes:** `CURRENT_PRD_v1.3.md` for MVP scope, delivery phases, and planning-economics classification  
> **Truth status:** product specification; implementation remains unverified until code and runtime evidence satisfy the linked Jira criteria

## 1. Product goal

EasyTree provides one authoritative operational workflow for small tree-care and field-service organisations: weekly planning, worksites, people, qualifications, vehicles and equipment, published assignments, employee time capture, and structured communication between field crews and the office.

The MVP additionally includes a deliberately bounded internal-cost capability. Authorised management roles can understand planned and confirmed internal worksite costs and export them without turning EasyTree into payroll, accounting, invoicing, or procurement software.

## 2. Users and access boundaries

### Employee

- reads only own published assignments and relevant worksite information;
- starts and stops own time entry;
- receives reminders for a missing start or outstanding stop;
- reports missing equipment and the condition of existing resources;
- cannot read cost rates, cost positions, or management reports.

### Planner and administrator

- manages worksites, people, skills, qualifications, and resources;
- creates and publishes conflict-checked plan versions;
- reviews time entries, resource use, and equipment requests when authorised;
- manages internal rates only with a dedicated permission.

### Management

- reads operational and internal-cost summaries;
- compares planned and confirmed costs;
- exports authorised cost data;
- remains responsible for all exception and business decisions.

Authentication alone grants none of these actions. The API validates organisation, active membership, employee subject, role, and atomic permission. Row-level security remains defence in depth.

## 3. MVP functional requirements

### FR-001 Weekly planning and publication

A planner creates versioned weekly plans with worksites, activities, employees, and explicit UTC time intervals. Drafts and published versions remain separate and auditable.

### FR-002 Deterministic conflict checks

Publication rejects invalid intervals, employee overlaps, approved absences, enabled capacity blockers, unavailable or double-booked exclusive resources, and missing mandatory qualifications. The server is authoritative and returns stable, explainable conflict codes.

### FR-003 Skills and qualifications

The organisation maintains a skill and qualification catalogue. Employee qualifications can have effective dates. A worksite, activity, day, or interval can define required qualifications.

### FR-004 Resources

Vehicles, tools, devices, and machines are uniquely identifiable, reservable for time intervals, and subject to availability and condition. Condition reports and equipment-needs reports are distinct workflows.

### FR-005 Equipment needs

An employee can report missing or additionally required equipment for an assigned worksite. The office receives the request in a prioritised inbox and can progress it through an audited status flow. The MVP performs no automatic order and no silent plan change.

### FR-006 Time capture and correction

An employee starts and stops time only from an allowed own assignment. At most one active entry exists per employee. Approval and correction preserve the original, revised value, actor, reason, and audit history.

### FR-007 Start and stop reminders

The system can create an in-app reminder when no time entry exists around the planned start or when an entry remains active after the planned end or an unusual duration. A reminder never starts, stops, or corrects time automatically.

### FR-008 Internal rates

Authorised roles maintain individual internal net hourly or daily rates in EUR for employees, contractors, vehicles, devices, and machines. Rates have effective dates and immutable versions. Overlapping effective intervals for the same subject and rate type are rejected.

### FR-009 Planned internal costs

Planned costs are derived from one concrete published plan version, planned employee duration, reserved resources, and the rate versions valid at the service instant.

### FR-010 Confirmed internal costs

Confirmed employee costs derive only from approved time entries. Confirmed resource costs derive only from explicitly confirmed resource use. The application must not present planned reservations as actual use.

### FR-011 Cost reporting

Authorised roles can aggregate and drill down planned and confirmed costs by assignment, worksite, local business date, ISO week, and selected period. Each position exposes its source, quantity or duration, unit, rate version, and amount.

### FR-012 Excel cost export

The authorised cost projection can be exported as an Excel file. The export uses exactly the same server-side rules, rounding, filters, permissions, and calculation snapshot as the visible report.

### FR-013 PDF and print export

An authorised user can print or export a versioned work week containing worksites, intervals, assigned people, resources, meeting points, and relevant qualification notes. Economic data is included only with the dedicated permission.

## 4. Non-functional requirements

- shared-schema multi-tenancy with fail-closed tenant context;
- server-side authorisation and cross-tenant negative tests for every new module;
- UTC instants, explicit IANA time zone, and local business dates;
- idempotent domain commands and immutable audit evidence;
- no operational browser writes directly to Supabase;
- exact money representation, not binary floating point;
- one documented rounding policy reused by UI, API, and exports;
- accessible and outdoor-usable employee interactions;
- no production-readiness claim without security, accessibility, migration, load, recovery, observability, backup/restore, and rollback evidence.

## 5. Internal cost rules

### Rates

- currency: EUR net;
- unit: hour or day;
- validity: `valid_from`, optional `valid_to`;
- no overlapping active intervals for the same subject and rate type;
- modification creates a new version.

### Calculation provenance

Each persisted or reproducible calculation state references:

- organisation and worksite;
- plan version or approved actual source;
- calculation-rules version;
- rate versions used;
- quantity or duration;
- creation instant and correlation identifier.

Later rate changes must not silently alter historic results.

## 6. MVP boundaries

### Included

- planning, publication, resources, qualifications, and time capture;
- equipment-needs reporting and office inbox;
- start and stop reminders;
- internal rates and planned/confirmed worksite costs;
- Excel cost export;
- PDF/print week export.

### Explicitly post-MVP

- machine-rental revenue;
- payroll and wage calculation;
- invoices, VAT, payments, receivables, or accounting entries;
- DATEV, ERP, or payroll integration;
- purchasing, inventory, or automatic procurement;
- margin, budget forecasting, or autonomous economic decisions;
- generic offline write queue.

## 7. Delivery sequence

1. finish the real planning-draft and conflict write-through slice;
2. prove publication and employee read-through;
3. deliver versioned rates, planned cost, and Excel export;
4. deliver equipment request and office inbox;
5. deliver dated qualification requirements and publish blocker;
6. deliver time capture and start/stop reminders;
7. deliver confirmed resource use and actual cost;
8. complete cross-module E2E, security, accessibility, and operational gates.

The sequence is a roadmap, not a commitment to fit all capabilities into one sprint.

## 8. MVP acceptance

The expanded MVP is accepted only when at least:

- a permitted planner reads real PostgreSQL data, creates a valid draft, and receives an explainable rejection for an invalid draft;
- a published version appears in the employee view with identical plan and assignment identifiers;
- mandatory qualifications and exclusive-resource constraints are enforced at publication;
- an employee can start and stop server-owned time;
- an equipment request can travel from employee to office and back as status;
- planned and evidenced actual costs are reproducible with historic rate versions;
- UI and Excel export produce the same authorised amounts;
- employee roles cannot read economic data;
- two synthetic organisations remain isolated in all new flows;
- browser, API, PostgreSQL, and negative tests prove the journeys.

## 9. Changes from v1.3

The following v1.3 statements are superseded:

1. Planning economics is no longer wholly post-MVP.
2. Internal rates, planned/confirmed costs, and Excel export are part of a bounded MVP slice.
3. Machine-rental revenue remains post-MVP.
4. PDF/print export and CSV import are separate delivery items.
5. Qualification validity and day/worksite-specific requirements are explicit.
6. Start and stop reminders are separate from the timer and never mutate time automatically.
7. Missing-equipment requests are separate from resource-condition reports.

All v1.3 architecture, privacy, planning, time, and production-gate requirements remain applicable unless this document explicitly replaces them.

## 10. Jira traceability

- Planning and publication: EYT-3, EYT-18, EYT-50, EYT-62, EYT-92, EYT-98
- Resources and qualifications: EYT-5, EYT-22, EYT-23, EYT-93, EYT-96, EYT-97, EYT-99
- Time and reminders: EYT-6, EYT-24, EYT-25, EYT-100, EYT-101
- Internal costs and export: EYT-10, EYT-36, EYT-37, EYT-39, EYT-94, EYT-95
- PDF and CSV: EYT-31, EYT-102
- Authorisation and invariants: EYT-14, EYT-45, EYT-61

## 11. Gate decision

`PASS_WITH_ASSUMPTIONS` for product scope and backlog structure. `BLOCKED_RELEASE` until implementation and production evidence satisfy the requirements.