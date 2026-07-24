# Arboscus Teamplaner - Final Product Requirements Document

**Version:** 1.1-final-weather  
**Date:** 2026-07-23  
**Status:** release at product level; production remains gated by ADR, security, legal, and operational checkpoints.

## meta

- Skill: `ai-native-prd-architect`
- Mode: `full_prd`
- Schema: `1.1`
- Artifacts: `prd_report.md`, `prd_report.json`, `traceability_matrix.csv`, `agent_handoff.md`

## intake_scope

**Goal:** Create the final PRD for the Arboscus Teamplaner MVP.

**In scope**

- Full product PRD
- Traceability
- Security controls
- Architecture constraints
- Implementation phases
- Agent handoff
- Worksite weather for today and the following day
- Explicit employee lifecycle management
- Pilot acceptance scenario with at least twelve active employees and three parallel worksites

**Out of scope**

- Implementation code
- Repository-specific implementation plan
- Provider contracting
- Legal certification

**Missing inputs**

- Repository and selected implementation stack
- Concrete infrastructure and external provider ADRs
- Legally approved retention periods
- Measured pilot baselines and target values

**Assumptions**

- The source basis v6 and subsequent accepted decisions represent current product intent.
- The initial organization is small but user/worksite counts remain dynamic.
- ASSUMPTION: Weather information is advisory and does not automatically block planning or stop work until an explicit stakeholder decision defines such behavior.

## source_inventory

| ID      | Type                  | Source                                                        | Supports                                                                                                                                                                       | Confidence |
| ------- | --------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------: |
| SRC-001 | user_provided         | Initial product discovery and clarification conversation      | Business problem, users, workflows, scope decisions, UX principles, and acceptance decisions.                                                                                  |          5 |
| SRC-002 | user_provided         | Arboscus Teamplaner MVP and PRD basis v6                      | Consolidated facts, requirements, acceptance criteria, decisions, and release scope.                                                                                           |          5 |
| SRC-003 | user_provided         | Arboscus activity catalog                                     | Initial selectable worksite activities and their informational descriptions.                                                                                                   |          5 |
| SRC-004 | standard_or_framework | AI-Native PRD Architect output contract                       | Required PRD structure, traceability, security controls, and artifact schema.                                                                                                  |          5 |
| SRC-005 | standard_or_framework | Architecture quality gates                                    | Domain separation, external adapters, server-side authorization, ADR requirements.                                                                                             |          5 |
| SRC-006 | derived_assumption    | Implementation-neutral architecture baseline                  | A modular web application with service boundaries is a safe baseline until a repository and stack are selected.                                                                |          3 |
| SRC-007 | user_provided         | Supplementary MVP target document                             | Compatible supplementary precision for employee lifecycle and the pilot scenario of about twelve users and two to three parallel worksites.                                    |          5 |
| SRC-008 | user_provided         | PRD precedence clarification and worksite weather requirement | The approved PRD remains authoritative; compatible supplements may be added; each employee shall receive current-day and next-day worksite weather from a weather-service API. |          5 |

## standards_alignment

| ID      | Standard                  | Applies to                         | Claim            | Limitations                                               |
| ------- | ------------------------- | ---------------------------------- | ---------------- | --------------------------------------------------------- |
| STD-001 | CommonMark 0.31.2         | prd_report.md                      | standard_aligned | No certification claim.                                   |
| STD-002 | RFC 8259 JSON RFC 8259    | prd_report.json                    | schema_validated | Validation is local and structural.                       |
| STD-003 | JSON Schema Draft 2020-12 | prd_report.json                    | schema_validated | Validation does not prove business correctness.           |
| STD-004 | ISO/IEC/IEEE 29148 2018   | requirements quality, traceability | standard_aligned | Not a formal conformity assessment.                       |
| STD-005 | NIST SSDF SP 800-218 1.1  | secure development controls        | standard_aligned | Implementation evidence must be produced during delivery. |

## risk_gate

**Risk level:** `high`

**Reasons**

- Personal employee, absence, working-time, private-origin, and damage data.
- Configurable permissions and admin actions.
- Safety-relevant device blocking and release.
- External email, routing, transcription, and file services.
- External weather data can be stale, unavailable, or misleading if location or timestamp is unclear.

**Allowed actions**

- Finalize product requirements
- Create prototype
- Create ADRs and implementation plan
- Implement only after phase gates

**Blocked actions**

- Production launch without retention/privacy/provider review
- Real-data pilot without authorization and security tests
- Safety-critical release without restricted authorization and audit

## mode_selection

`full_prd` - The user requested a final PRD for a multi-domain application intended for agent-assisted implementation.

## artifact_policy

- Mandatory Markdown: prd_report.md
- Mandatory machine output: prd_report.json
- Conditional: code_findings.sarif.json when code or repository findings exist
- Claim policy: standard_aligned_not_certified

## optional_artifacts

- `traceability_matrix.csv` (optional): Downstream planning or CI needs requirement mapping.; validator: CSV parser and ID consistency check
- `agent_handoff.md` (optional): Coding agent implementation begins.; validator: Human review against agent-handoff contract
- `code_findings.sarif.json` (not_emitted): Code or repository findings exist.; validator: validate_sarif.py

## prd_markdown

### 1. Executive Summary

#### INFO-001 - summary [P0 / accepted]

The Arboscus Teamplaner is a mobile-first, installable web application for planning employees, worksites, activities, skills, resources, absences, damage reports, and personal working time in a small tree-care company.

#### GOAL-001 - goal [P0 / accepted]

Create one authoritative weekly planning view so every employee knows where, when, with whom, and on which activity they work.

#### INFO-002 - scope [P0 / accepted]

The first release is a broad MVP delivered in increments: clickable prototype, planning and authorization core, resources and time, then extended release functions.

#### INFO-003 - decision [P0 / accepted]

This PRD is implementation-ready at product level. Provider, hosting, retention, and repository-specific choices remain ADR items before production.

#### INFO-004 - scope_update [P1 / accepted]

Version 1.1 adds advisory worksite weather for today and the following day, explicit employee lifecycle management, and a non-maximum pilot acceptance scenario of at least twelve active employees and three parallel worksites.

### 2. Problem Statement

#### INFO-010 - problem [P0 / accepted]

Planning information is fragmented across Hero, Excel, messengers, paper calendars, and memory; employees sometimes ask shortly before work where they are assigned.

#### INFO-011 - problem [P0 / accepted]

The business lacks a shared, current view of employee assignments, absences, skills, device failures, and worksite changes.

#### INFO-012 - problem [P0 / accepted]

Resource failures and damage reports are not reliably captured and propagated to every affected future worksite.

#### INFO-013 - problem [P1 / accepted]

Current software is perceived as expensive and insufficiently aligned with the concrete weekly planning workflow; exact Hero replacement scope is not a requirement of this release.

### 3. Goals and Non-Goals

#### GOAL-002 - goal [P0 / accepted]

Reduce planning effort and avoid unclear or conflicting assignments.

#### GOAL-003 - goal [P0 / accepted]

Give employees immediate mobile access to the current and next assignments, worksite briefing, team, activities, and resources.

#### GOAL-004 - goal [P0 / accepted]

Make published plans, changes, confirmations, rejections, and escalation states visible and auditable.

#### GOAL-005 - goal [P0 / accepted]

Support configurable roles, permissions, skills, worksite activities, resource attributes, and selected status values through a non-technical UI.

#### GOAL-006 - goal [P0 / accepted]

Capture damage reports and resource unavailability early enough to influence planning.

#### GOAL-007 - goal [P1 / accepted]

Provide personal start-stop time documentation and an approval/correction workflow without payroll calculations.

#### GOAL-008 - goal [P0 / accepted]

Achieve high adoption through large touch targets, direct actions, visible options, and minimal interaction depth.

#### NOGOAL-001 - non_goal [P0 / accepted]

No payroll, salary, honorarium, invoice, hourly-rate, daily-rate, or lump-sum price calculation.

#### NOGOAL-002 - non_goal [P0 / accepted]

No continuous GPS tracking, movement profiles, geofencing, or automatic location-based attendance.

#### NOGOAL-003 - non_goal [P1 / accepted]

No complete ERP, warehouse, maintenance, procurement, or insurance-case management system.

#### NOGOAL-004 - non_goal [P1 / accepted]

No complete replication of all Hero functions and no full historical Hero migration.

#### NOGOAL-005 - non_goal [P0 / accepted]

No free-form no-code object builder; core domain objects and protected workflow semantics remain fixed.

#### GOAL-009 - goal [P1 / accepted]

Give assigned employees location-specific weather context for today and the following day so they can prepare for worksite conditions.

### 4. Stakeholders and Users

#### INFO-020 - stakeholder [P0 / accepted]

Arboscus GmbH management is product sponsor and final business decision authority.

#### INFO-021 - user [P0 / accepted]

Administrator configures users, roles, permissions, worksites, activities, skills, resources, and planning data.

#### INFO-022 - user [P0 / accepted]

Management plans and publishes work, reviews rejections, approves absences and time entries, and releases blocked devices.

#### INFO-023 - user [P0 / accepted]

Operational employee views own assignments and team, confirms or rejects, starts/stops time, and reports damage.

#### INFO-024 - user [P1 / accepted]

Free employee uses the same operational experience; employment type is metadata, not a separate product role.

#### INFO-025 - user [P2 / accepted]

Bookkeeping may receive a configurable limited role but has no payroll or invoice workflow in this product.

#### INFO-026 - reviewer [P0 / accepted]

Pilot reviewers must include management, administrator, operational employee, and preferably a less technical or new employee.

### 5. Definitions and Domain Glossary

#### TERM-001 - term [P0 / accepted]

Worksite: a planned location with name, address, color, activities, briefing, team, resources, and time-bounded assignments.

#### TERM-002 - term [P0 / accepted]

Assignment: the central link between employee, worksite, start/end time, task, team role, status, and confirmation state.

#### TERM-003 - term [P0 / accepted]

Activity: selectable type of work performed at a worksite; at least one is required before publication.

#### TERM-004 - term [P0 / accepted]

Skill: configurable practical capability assigned to employees and required by worksites.

#### TERM-005 - term [P2 / accepted]

Qualification: formal certificate or evidence, excluded from deep MVP functionality and planned as a later extension.

#### TERM-006 - term [P0 / accepted]

Role: exactly one configurable permission bundle assigned to a user.

#### TERM-007 - term [P0 / accepted]

Permission: an atomic server-enforced capability such as viewing all worksites or correcting time.

#### TERM-008 - term [P0 / accepted]

Published week: a released weekly plan visible to affected employees and requiring collected weekly confirmation.

#### TERM-009 - term [P0 / accepted]

Material change: a change to time, worksite, or required presence that reopens confirmation only for the changed appointment.

#### TERM-010 - term [P0 / accepted]

Resource: uniquely identifiable device or vehicle with configurable attributes, availability, reservations, and damage state.

#### TERM-011 - term [P0 / accepted]

Damage report: structured report with object, worksite, reporter, time, description, severity, usability assessment, and attachments.

#### TERM-012 - term [P0 / accepted]

Protected core status: non-deletable workflow semantic used by system logic; labels or colors may be configured but meaning remains fixed.

#### TERM-013 - term [P0 / accepted]

Audit record: append-only record of relevant state changes, actor, time, previous value, new value, and reason.

### 6. Assumptions, Missing Inputs, and Open Questions

#### OPEN-001 - open_question [P0 / needs_review]

OPEN QUESTION: Select the concrete EU hosting platform, database, and file storage through ADR-001 before implementation foundation is approved.

#### OPEN-002 - open_question [P0 / needs_review]

OPEN QUESTION: Select transactional email, maps/routing, and transcription providers, including data-processing terms and failure behavior.

#### OPEN-003 - open_question [P0 / needs_review]

OPEN QUESTION: Define legally reviewed retention and deletion periods for working time, absences, damage photos, audit logs, and private route origins before production.

#### OPEN-004 - open_question [P0 / missing]

MISSING: Repository, implementation stack, coding standards, and executable validation commands are not supplied; these must be defined in the implementation plan.

#### OPEN-005 - assumption [P1 / assumption]

ASSUMPTION: The initial operational scale is small, but the product must not encode a fixed employee or worksite limit.

#### OPEN-006 - open_question [P1 / needs_review]

OPEN QUESTION: Establish baseline and target values for planning effort, unanswered assignments, and avoidable planning conflicts during pilot preparation.

#### OPEN-007 - open_question [P1 / needs_review]

OPEN QUESTION: Define mandatory weather fields, temporal resolution, refresh interval, stale-data fallback, warning channels, visibility, and whether weather is advisory only.

### 7. Product Scope

#### INFO-030 - scope [P0 / accepted]

In scope: individual accounts, invitation, password reset, revocable sessions, configurable roles and permissions.

#### INFO-031 - scope [P0 / accepted]

In scope: weekly and monthly planning, four-week rolling horizon, assignments with exact start/end times, full-day and half-day shortcuts.

#### INFO-032 - scope [P0 / accepted]

In scope: draft and publish workflow, weekly confirmation, per-change reconfirmation, rejection with mandatory reason, reminders and escalation.

#### INFO-033 - scope [P0 / accepted]

In scope: worksites, required activities, briefing, notes, attachments, navigation, teams, skills, resources, and absence-aware visibility.

#### INFO-034 - scope [P0 / accepted]

In scope: unique resources, reservations, cross-worksite failure propagation, damage reporting, blocking, and restricted release.

#### INFO-035 - scope [P1 / accepted]

In scope: start-stop time, long-running timer reminder, approval/correction workflow, and personal overview.

#### INFO-036 - scope [P1 / accepted]

In scope: profile images, avatar pool, saved filters, PDF/print export, voice notes with reviewable transcription, route duration, read-only offline cache, and limited CSV import.

#### INFO-037 - scope [P1 / accepted]

Out of scope: formal certificate lifecycle, offline editing/synchronization, native mobile apps, SMS, full maintenance/procurement, and payroll/accounting.

#### INFO-038 - scope [P1 / accepted]

Extended first-release scope includes a weather card for each assigned worksite, populated through an external weather-service adapter for today and the following day.

### 8. User Journeys

#### JOURNEY-001 - journey [P0 / accepted]

Employee signs in and sees the current or next assignment without searching.

#### JOURNEY-002 - journey [P0 / accepted]

Employee opens the weekly plan, worksite, navigation, activities, team, resources, and operational notes.

#### JOURNEY-003 - journey [P0 / accepted]

Employee confirms the published week or rejects an assignment with category and mandatory explanation.

#### JOURNEY-004 - journey [P0 / accepted]

Planner builds a week using drag-and-drop or visible assignment cards, resolves blocking conflicts, and publishes.

#### JOURNEY-005 - journey [P0 / accepted]

Planner changes a material appointment; only affected employees receive a new confirmation request for that appointment.

#### JOURNEY-006 - journey [P0 / accepted]

Administrator creates a role, selects permissions, receives privacy warnings, and assigns it to a user.

#### JOURNEY-007 - journey [P1 / accepted]

Employee starts and stops time from the planned assignment; management reviews or corrects it with audit history.

#### JOURNEY-008 - journey [P0 / accepted]

Employee reports damage with photo or reviewed voice transcription; affected reservations are flagged and authorized users release the resource later.

#### JOURNEY-009 - journey [P0 / accepted]

Employee submits vacation; administrator or management approves it, and planning blocks overlapping assignments.

#### JOURNEY-010 - journey [P1 / accepted]

Employee reads previously loaded assignment information during temporary connectivity loss.

#### JOURNEY-011 - user_journey [P1 / accepted]

An employee opens the current or next assignment and sees worksite weather for today and the following day, including source freshness and a clear stale or unavailable state.

### 9. AI-Ready User Stories

#### STORY-001 - user_story [P0 / accepted]

As an employee, I want to see my next worksite immediately so I can prepare without asking by phone.

#### STORY-002 - user_story [P0 / accepted]

As a planner, I want to see employees, absences, skills, and resources in one weekly view so I can build feasible teams.

#### STORY-003 - user_story [P0 / accepted]

As an employee, I want to confirm the full published week and only reconfirm later changed appointments.

#### STORY-004 - user_story [P0 / accepted]

As an employee, I want to reject an assignment with a reason so management can resolve the issue.

#### STORY-005 - user_story [P0 / accepted]

As an administrator, I want to create understandable roles and permissions without editing code.

#### STORY-006 - user_story [P0 / accepted]

As a team member, I want to see only coworkers relevant to my worksite and time period.

#### STORY-007 - user_story [P0 / accepted]

As a planner, I want unavailable or double-booked employees and resources to block publication.

#### STORY-008 - user_story [P0 / accepted]

As an employee, I want to report damage quickly with a photo or voice note.

#### STORY-009 - user_story [P0 / accepted]

As management, I want device release restricted and audited.

#### STORY-010 - user_story [P0 / accepted]

As an employee, I want a single large action to start and stop my working time.

#### STORY-011 - user_story [P0 / accepted]

As management, I want to approve or correct time while preserving the original record.

#### STORY-012 - user_story [P1 / accepted]

As an employee, I want navigation and estimated travel time without exposing my home location to coworkers.

#### STORY-013 - user_story [P1 / accepted]

As a user, I want saved filters and exports that never expand my data permissions.

#### STORY-014 - user_story [P1 / accepted]

As an administrator, I want to extend activities and resource attributes without creating new domain objects.

#### STORY-015 - user_story [P1 / accepted]

As an employee, I want already loaded assignments to remain readable during a network outage.

#### STORY-016 - user_story [P1 / accepted]

As an assigned employee, I want current-day and next-day weather for my worksite so that I can prepare clothing, equipment, and arrival decisions without leaving the app.

### 10. Functional Requirements

#### FR-001 - functional_requirement [P0 / accepted]

Account lifecycle: Administrators can invite, activate, deactivate, and archive user accounts; users can set and reset passwords; active sessions are revocable.

#### FR-002 - functional_requirement [P0 / accepted]

Single role assignment: Each user has exactly one role. Initial role templates are Employee, Administrator, and Management.

#### FR-003 - functional_requirement [P0 / accepted]

Configurable permissions: Administrators can create, clone, edit, and deactivate roles and select atomic permissions in the UI.

#### FR-004 - functional_requirement [P0 / accepted]

Scoped visibility: Server-side authorization limits employees to own assignments, assigned worksites, relevant team members, and permitted data.

#### FR-005 - functional_requirement [P0 / accepted]

Calendar views and filters: Provide week as primary view, month as secondary view, and filters for worksite, day, week, employee, absence, skill, resource, damage status, confirmation status, and running time.

#### FR-006 - functional_requirement [P1 / accepted]

Saved filters: Users can save and restore permitted personal calendar views without gaining additional data access.

#### FR-007 - functional_requirement [P0 / accepted]

Worksite lifecycle: Authorized users create, edit, archive, and color-code worksites with required name, location, at least one employee, and at least one activity before publication.

#### FR-008 - functional_requirement [P0 / accepted]

Activity catalog: Worksite activities are multi-select checkbox labels with optional information popups; administrators can add and deactivate activities.

#### FR-009 - functional_requirement [P0 / accepted]

Assignment planning: Assignments support exact start/end time, full-day and half-day shortcuts, multiple worksites per day, moving, swapping, and additional team members.

#### FR-010 - functional_requirement [P0 / accepted]

Draft and publication: Plans can be saved as drafts visible only to authorized roles; Administrator and Management can publish.

#### FR-011 - functional_requirement [P0 / accepted]

Confirmation lifecycle: Initial publication requests one confirmation for the week; material later changes request confirmation only for changed appointments.

#### FR-012 - functional_requirement [P0 / accepted]

Rejection workflow: Every employee can reject an assignment; category and free-text explanation are mandatory and visible to Administrator and Management.

#### FR-013 - functional_requirement [P0 / accepted]

Notifications: Every relevant event produces both email and in-app notification; responses occur only inside the application.

#### FR-014 - functional_requirement [P1 / accepted]

Global messages: Only Administrator and Management can send an organization-wide message.

#### FR-015 - functional_requirement [P0 / accepted]

Conflict engine: Publication is blocked by overlapping assignments, approved absence, enabled capacity overflow, double-reserved resources, or blocked resources; other configured issues produce warnings.

#### FR-016 - functional_requirement [P1 / accepted]

Capacity budget: An optional weekly hour budget can be set per employee; when active, exceeding it blocks publication unless Administrator or Management overrides with reason.

#### FR-017 - functional_requirement [P0 / accepted]

Skills: Administrators maintain skills, assign them to employees, declare worksite skill needs, and view gaps.

#### FR-018 - functional_requirement [P0 / accepted]

Absence workflow: Employees and planners can create absence entries; vacation requires Administrator or Management approval.

#### FR-019 - functional_requirement [P0 / accepted]

Sickness workflow: Sickness creates immediate unavailability; coworkers see only relevant unavailability, not medical details.

#### FR-020 - functional_requirement [P0 / accepted]

Team visibility: Employees see names and avatars of coworkers only for the same worksite and overlapping time unless their role grants broader access.

#### FR-021 - functional_requirement [P1 / accepted]

Worksite notes: Administrator creates, edits, and deletes operational worksite notes; assigned employees can read them.

#### FR-022 - functional_requirement [P1 / accepted]

Attachments: Worksites, resources, and damage reports accept authorized JPG, PNG, and PDF files up to 10 MB with mobile image compression.

#### FR-023 - functional_requirement [P0 / accepted]

Resource register: Devices and vehicles are uniquely identifiable, support configurable attributes, status, availability, and worksite reservation.

#### FR-024 - functional_requirement [P0 / accepted]

Resource impact propagation: A resource failure or block is stored centrally and flags every affected current and future worksite/reservation.

#### FR-025 - functional_requirement [P0 / accepted]

Damage reporting: Every app user can submit a structured damage report; a heavy or safety-critical report requires at least one photo.

#### FR-026 - functional_requirement [P0 / accepted]

Restricted device release: Only Administrator and Management can formally release a blocked or safety-critical resource, with reason and audit record.

#### FR-027 - functional_requirement [P1 / accepted]

Time start/stop: Employees can start exactly one timer only from a planned assignment and stop it to create a time entry.

#### FR-028 - functional_requirement [P1 / accepted]

Long-running timer: After ten hours, employee receives email and in-app confirmation prompt; the timer remains running and is visibly flagged.

#### FR-029 - functional_requirement [P1 / accepted]

Time approval and correction: Completed entries move to pending approval; authorized roles approve, correct, or mark for clarification while preserving originals and notifying employee.

#### FR-030 - functional_requirement [P0 / accepted]

No monetary conversion: Time data never produces wages, rates, fees, invoice values, or accounting entries.

#### FR-031 - functional_requirement [P1 / accepted]

Navigation and travel time: Employee can open external navigation and optionally store a private personal origin for estimated travel time; coworkers cannot see it.

#### FR-032 - functional_requirement [P1 / accepted]

Read-only offline access: Previously loaded current and upcoming assignments, worksite information, and needed contacts are readable offline with synchronization timestamp.

#### FR-033 - functional_requirement [P1 / accepted]

Installable PWA: The responsive mobile-first application can be installed from supported browsers and used in app-like mode.

#### FR-034 - functional_requirement [P1 / accepted]

Profile image and avatar pool: Employees can upload a profile image or choose an administrator-provided avatar; administrators can remove inappropriate images.

#### FR-035 - functional_requirement [P1 / accepted]

PDF and print export: Authorized users export a print-ready weekly plan limited to their current visibility rights.

#### FR-036 - functional_requirement [P1 / accepted]

Limited CSV import: Authorized users import active employees, skills, resources, and open worksites using preview and error reporting.

#### FR-037 - functional_requirement [P0 / accepted]

Audit log: Relevant planning, authorization, absence, resource, damage, time, and configuration changes create append-only audit records.

#### FR-038 - functional_requirement [P1 / accepted]

Four-week horizon: Planning supports a rolling four-week overview while keeping the operational week primary.

#### FR-039 - functional_requirement [P1 / accepted]

Short-notice assignment: Assignments less than 24 hours before start can be published; missing response is visible for manual resolution.

#### FR-040 - functional_requirement [P1 / accepted]

Reminder and escalation: Unanswered assignments trigger configurable reminder and escalation, initially after 24 hours.

#### FR-041 - functional_requirement [P1 / accepted]

Voice note transcription: Damage reports accept voice notes; transcribed text must be shown for user review and explicit confirmation before submission.

#### FR-042 - functional_requirement [P1 / accepted]

Worksite activity changes: Activity changes are audited and notify assigned employees; activity-only changes do not reopen attendance confirmation.

#### FR-043 - functional_requirement [P1 / accepted]

Worksite weather: For every assigned worksite visible to an employee, the app displays weather for the current day and the following day using the worksite location and an external weather-service API. The UI displays the forecast timestamp and a clear unavailable or stale state.

#### FR-044 - functional_requirement [P0 / accepted]

Employee lifecycle: Authorized users can create, edit, deactivate, and archive employee records. Historical assignments, time entries, approvals, damage reports, and audit records remain referentially intact.

### 11. Non-Functional Requirements

#### NFR-001 - non_functional_requirement [P0 / accepted]

Mobile-first usability: Primary operational journeys must work on smartphones with large touch targets and no precision clicking.

#### NFR-002 - non_functional_requirement [P0 / accepted]

Immediate orientation: The first viewport shows current/next assignment, time, worksite, confirmation state, and one clear primary action.

#### NFR-003 - non_functional_requirement [P0 / accepted]

Interaction economy: Common employee actions require minimal steps; unnecessary dropdowns and hidden menus are prohibited.

#### NFR-004 - non_functional_requirement [P0 / accepted]

Accessible status communication: Color is always supplemented by text, icon, initials, or pattern; contrast and font sizes support outdoor use and color-vision differences.

#### NFR-005 - non_functional_requirement [P1 / accepted]

Performance: On a supported mobile device and normal mobile connection, cached shell loads promptly and primary worksite/weekly views should reach interactive state within a target agreed during technical planning.

#### NFR-006 - non_functional_requirement [P0 / accepted]

Reliability: Publishing, confirmations, time entries, damage reports, and resource blocks must be transactionally consistent and idempotent.

#### NFR-007 - non_functional_requirement [P1 / accepted]

Browser support: Support current Safari and Chrome on iOS/Android and current Chrome, Edge, and Safari on desktop.

#### NFR-008 - non_functional_requirement [P0 / accepted]

Security: Authentication, authorization, session revocation, upload protection, and audit logging are mandatory before pilot with real data.

#### NFR-009 - non_functional_requirement [P0 / accepted]

Privacy: Collect only necessary employee, absence, route-origin, time, and damage data; no continuous tracking.

#### NFR-010 - non_functional_requirement [P0 / accepted]

Maintainability: Domain logic, UI, persistence, background jobs, and vendor adapters remain separated and testable.

#### NFR-011 - non_functional_requirement [P0 / accepted]

Configurability boundary: Administrators can change approved catalogs, fields, labels, and permissions without altering protected core objects or workflow semantics.

#### NFR-012 - non_functional_requirement [P0 / accepted]

Backup and recovery: Daily backups and a tested restore procedure are required before production.

#### NFR-013 - non_functional_requirement [P1 / accepted]

Offline transparency: Offline data is read-only and clearly shows last synchronization time and stale state.

#### NFR-014 - non_functional_requirement [P0 / accepted]

Auditability: Sensitive state changes must preserve actor, timestamp, old value, new value, and required reason.

#### NFR-015 - non_functional_requirement [P2 / accepted]

Scalability: No fixed technical limit is tied to the current employee or worksite count.

#### NFR-016 - non_functional_requirement [P1 / accepted]

Weather freshness and resilience: Weather responses are cached for a configurable bounded period, show fetched-at time and provider attribution where required, never fabricate missing values, and degrade to a clearly marked last-known or unavailable state.

#### NFR-017 - non_functional_requirement [P1 / accepted]

Pilot-load acceptance: The pilot test dataset includes at least twelve active employees and three parallel worksites without treating these values as technical maxima. Core week planning remains correct and usable at that load.

### 12. Data Model and Core Entities

#### DATA-001 - data_entity [P0 / accepted]

UserAccount: Identity, email, credential reference, status, one role, sessions, last login, and employee relation.

#### DATA-002 - data_entity [P0 / accepted]

Role: Name, active state, permission set, protected/template indicator, audit metadata.

#### DATA-003 - data_entity [P0 / accepted]

Permission: Stable code, plain-language description, sensitivity level, and domain scope.

#### DATA-004 - data_entity [P0 / accepted]

Employee: Name, avatar/profile image, contact data, employment metadata, skills, weekly capacity, private origin reference, status.

#### DATA-005 - data_entity [P0 / accepted]

Worksite: Name, identifier, address, coordinates/link, color, period, status, activities, briefing, tasks, notes, safety/access data.

#### DATA-006 - data_entity [P0 / accepted]

ActivityType: Checkbox label, info description, active state, sort order, historical preservation.

#### DATA-007 - data_entity [P0 / accepted]

Assignment: Employee, worksite, start/end, task, team role, status, publication version, confirmation state, change history.

#### DATA-008 - data_entity [P0 / accepted]

AssignmentConfirmation: Scope (week or changed appointment), response, reason category, free text, respondent, timestamps.

#### DATA-009 - data_entity [P0 / accepted]

Absence: Employee, type, start/end, request status, visibility, approver, timestamps.

#### DATA-010 - data_entity [P0 / accepted]

Skill: Name, category, description, employee assignments, worksite requirements.

#### DATA-011 - data_entity [P0 / accepted]

Resource: Unique identity, category, attributes, status, availability, active damage state.

#### DATA-012 - data_entity [P0 / accepted]

ResourceReservation: Resource, worksite, start/end, state, conflict metadata.

#### DATA-013 - data_entity [P0 / accepted]

DamageReport: Resource, worksite, reporter, observed time, description, suspected sequence, type, area, severity, usability, state.

#### DATA-014 - data_entity [P0 / accepted]

Attachment: Object relation, type, size, storage key, uploader, timestamp, visibility, integrity metadata.

#### DATA-015 - data_entity [P0 / accepted]

TimeEntry: Employee, assignment, date, start/end, duration, state, original values, correction chain.

#### DATA-016 - data_entity [P0 / accepted]

TimeApproval: Time entry, reviewer, decision, reason, old/new values, timestamps.

#### DATA-017 - data_entity [P0 / accepted]

Notification: Recipient, channel, event type, object relation, delivery state, read state, timestamps.

#### DATA-018 - data_entity [P0 / accepted]

AuditRecord: Actor, action, object, old/new representation or diff, reason, timestamp, request correlation.

#### DATA-019 - data_entity [P1 / accepted]

SavedFilter: Owner, view type, permitted filter configuration, name, timestamps.

#### DATA-020 - data_entity [P1 / accepted]

PrivateRouteOrigin: Employee-owned encrypted or protected origin data, not exposed to coworkers or exports.

#### DATA-021 - data_entity [P1 / accepted]

WeatherSnapshot: Worksite or normalized coordinates, forecast date and time range, selected weather values, provider, fetched-at time, valid-until time, status, and cache metadata. No employee home location is used for worksite weather.

### 13. API and Interface Requirements

#### API-001 - api_requirement [P0 / accepted]

Authentication and session API: Invite, activate, sign in, sign out, password reset, list/revoke sessions.

#### API-002 - api_requirement [P0 / accepted]

Users, roles, and permissions API: CRUD with authorization, role preview, impact warning, and last-admin protection.

#### API-003 - api_requirement [P0 / accepted]

Worksites and activities API: CRUD, required-field validation, activity catalog, notes, attachments, and archive.

#### API-004 - api_requirement [P0 / accepted]

Assignments and planning API: Query calendars, create/move/swap assignments, validate conflicts, draft, publish, change versions.

#### API-005 - api_requirement [P0 / accepted]

Confirmations API: Confirm week, reject appointment, reconfirm changed appointment, list pending/escalated responses.

#### API-006 - api_requirement [P0 / accepted]

Absence API: Create request, approve/reject vacation, record sickness, query role-scoped availability.

#### API-007 - api_requirement [P0 / accepted]

Skills API: Maintain catalog, assign employee skills, declare worksite requirements, compute gaps.

#### API-008 - api_requirement [P0 / accepted]

Resources and reservations API: Maintain resources, reserve time ranges, block/release, and expose affected worksites.

#### API-009 - api_requirement [P0 / accepted]

Damage API: Create report, upload evidence, update state, record release decision, retrieve audit trail.

#### API-010 - api_requirement [P0 / accepted]

Time API: Start/stop timer, list own time, pending approvals, approve/correct/clarify.

#### API-011 - api_requirement [P0 / accepted]

Notifications API: List/read in-app notifications and record delivery results; no email-side business response.

#### API-012 - api_requirement [P0 / accepted]

File API: Issue protected upload/download operations with type, size, malware, and access validation.

#### API-013 - api_requirement [P1 / accepted]

Routing adapter: Estimate route duration and produce external navigation link without exposing private origin.

#### API-014 - api_requirement [P1 / accepted]

Transcription adapter: Submit audio, receive transcript, delete or retain audio according to policy, require user review.

#### API-015 - api_requirement [P1 / accepted]

Export API: Generate role-filtered weekly PDF/print representation.

#### API-016 - api_requirement [P1 / accepted]

Import API: Validate, preview, and commit bounded CSV imports with row-level error output.

#### API-017 - api_requirement [P1 / accepted]

Weather adapter: Resolve forecast data for normalized worksite coordinates for today and the following day, expose freshness and provider errors, support bounded caching, and prevent provider-specific schemas from leaking into domain or UI contracts.

### 14. Architecture Constraints

#### ARCH-001 - architecture_constraint [P0 / accepted]

Domain independence: Domain rules must not depend on UI framework, HTTP controllers, database driver, email, maps, or transcription vendors.

#### ARCH-002 - architecture_constraint [P0 / accepted]

Module boundaries: Separate identity/access, planning, worksites, workforce, resources/damage, time, notifications, files, and reporting modules.

#### ARCH-003 - architecture_constraint [P0 / accepted]

Server-side authorization: Every protected query and mutation validates permission and object scope on the server.

#### ARCH-004 - architecture_constraint [P0 / accepted]

External ports: Email, routing, transcription, object storage, PDF generation, and monitoring are behind replaceable interfaces.

#### ARCH-005 - architecture_constraint [P0 / accepted]

Transactional publication: Plan publication, versioning, conflict validation, and confirmation requests use one consistent transaction or reliable outbox pattern.

#### ARCH-006 - architecture_constraint [P0 / accepted]

Idempotent commands: Publish, confirm, reject, start/stop timer, upload finalization, and notification jobs are idempotent.

#### ARCH-007 - architecture_constraint [P0 / accepted]

Read-only offline cache: Offline storage contains only authorized, previously loaded data and cannot mutate domain state.

#### ARCH-008 - architecture_constraint [P0 / accepted]

Append-only audit: Audit records cannot be modified or deleted by normal application workflows.

#### ARCH-009 - architecture_constraint [P0 / accepted]

Configuration boundary: Custom fields and catalogs extend predefined objects; they cannot create arbitrary executable workflows or bypass validation.

#### ARCH-010 - architecture_constraint [P0 / accepted]

Background job discipline: Reminder, escalation, email, transcription, export, and cleanup jobs specify retry limits, dead-letter behavior, and observability.

#### ARCH-011 - architecture_constraint [P0 / accepted]

Environment isolation: Development, test, and production use separate credentials, data stores, and storage buckets.

#### ARCH-012 - architecture_constraint [P0 / accepted]

ADR requirement: Hosting, database, object storage, email, maps, transcription, authentication, and observability choices require ADRs before implementation.

#### ARCH-013 - architecture_constraint [P1 / accepted]

The weather provider is accessed only through a replaceable adapter. Domain and presentation layers consume an internal weather contract; provider failure must not break assignment retrieval.

### 15. Security, Privacy, and Compliance Boundaries

#### SEC-001 - security_requirement [P0 / accepted]

Credential security: Passwords are stored using an approved password-hashing mechanism; plaintext or reversible password storage is prohibited.

#### SEC-002 - security_requirement [P0 / accepted]

Session control: Sessions are revocable, bounded in lifetime, protected against fixation, and invalidated for deactivated users.

#### SEC-003 - security_requirement [P0 / accepted]

Authorization matrix: Permissions and object scope are enforced server-side; UI hiding is never treated as authorization.

#### SEC-004 - security_requirement [P0 / accepted]

Sensitive permission warnings: Granting access to other employees, working times, absences, drafts, audit data, or device release requires explicit warning and audit.

#### SEC-005 - security_requirement [P0 / accepted]

Private origin protection: Private route origins are not shown to coworkers, exports, logs, or general administrators without a separately justified permission.

#### SEC-006 - security_requirement [P0 / accepted]

Absence minimization: Coworkers receive only relevant unavailability for overlapping work, never diagnoses or medical details.

#### SEC-007 - security_requirement [P0 / accepted]

Upload controls: File type, size, content disposition, access, and malware risk are validated; direct public object URLs are prohibited.

#### SEC-008 - security_requirement [P0 / accepted]

Audit protection: Audit data is append-only for normal users and includes correlation data without logging secrets or sensitive free text unnecessarily.

#### SEC-009 - security_requirement [P0 / accepted]

Destructive controls: Deletion is replaced by deactivation/archive where historical planning, damage, time, or audit integrity is required.

#### SEC-010 - security_requirement [P0 / accepted]

Release restriction: Only Administrator and Management can release blocked resources; action requires reason and reauthentication if risk level is high.

#### SEC-011 - security_requirement [P0 / accepted]

Data encryption: Transport encryption is mandatory; provider-supported encryption at rest is required for database, files, backups, and private origins.

#### SEC-012 - security_requirement [P0 / accepted]

Backup protection: Backups are access-controlled, encrypted, monitored, and restoration-tested.

#### SEC-013 - security_requirement [P0 / accepted]

Vendor privacy: Email, maps, transcription, hosting, and storage providers require documented data flows and processing terms before production.

#### SEC-014 - security_requirement [P0 / accepted]

No continuous tracking: The system must not collect continuous employee location, geofence events, or movement profiles.

#### SEC-015 - security_requirement [P0 / accepted]

Human review: Permission templates, retention policy, production data flows, and safety-critical resource workflow receive human review before production.

### 16. Sustainability and GreenOps

#### SUS-001 - sustainability_requirement [P2 / accepted]

Right-sized deployment: Select infrastructure proportional to a small organization; avoid unnecessary distributed services before measured need.

#### SUS-002 - sustainability_requirement [P2 / accepted]

Efficient queries: Index assignment, worksite, employee, time range, reservation, notification, and audit queries used by calendars and conflict checks.

#### SUS-003 - sustainability_requirement [P2 / accepted]

Bounded offline data: Cache only current and upcoming authorized data with explicit expiry and cleanup.

#### SUS-004 - sustainability_requirement [P2 / accepted]

Media efficiency: Compress mobile images and apply retention rules to audio and generated PDFs.

#### SUS-005 - sustainability_requirement [P2 / accepted]

Job efficiency: Batch reminders, exports, and cleanup work and cap retries to avoid unbounded background processing.

#### SUS-006 - sustainability_requirement [P2 / accepted]

Vendor cost visibility: Track routing, transcription, email, storage, and export usage per environment to detect cost drift.

#### SUS-007 - sustainability [P2 / accepted]

Weather calls use coordinate-and-time-window caching, request coalescing, and bounded refresh to avoid repeated external calls when several employees share the same worksite.

### 17. Context Engineering Artifacts

#### CTX-001 - context_artifact [P1 / accepted]

PRD source of truth: Store this PRD and JSON mirror in the repository under docs/prd/ before implementation.

#### CTX-002 - context_artifact [P1 / accepted]

Architecture decisions: Create ADRs for stack, hosting, auth, persistence, storage, email, routing, transcription, PDF, monitoring, and retention.

#### CTX-003 - context_artifact [P1 / accepted]

Permissions matrix: Maintain a machine-readable permission catalog with sensitivity classification and default role templates.

#### CTX-004 - context_artifact [P1 / accepted]

Domain glossary: Keep protected statuses, activity rules, conflict rules, and visibility semantics in version-controlled domain documentation.

#### CTX-005 - context_artifact [P1 / accepted]

API contracts: Publish OpenAPI or equivalent contracts for protected APIs before frontend/backend parallel implementation.

#### CTX-006 - context_artifact [P1 / accepted]

Test fixtures: Create deterministic fixtures for users, roles, worksites, activities, assignments, absences, resources, damage, and time.

#### CTX-007 - context_artifact [P1 / accepted]

Agent instructions: Add repository-specific AGENTS.md with allowed modules, validation commands, secrets rules, and stop conditions.

#### CTX-008 - context_artifact [P1 / accepted]

Decision log: Record product-scope changes and deferred items; agents must not silently promote deferred scope.

### 18. Implementation Phases

#### PHASE-001 - implementation_phase [P0 / accepted]

Clickdummy and UX validation: Build clickable mobile and desktop planning prototype for core journeys; test with representative users; freeze interaction decisions.

#### PHASE-002 - implementation_phase [P0 / accepted]

Foundation and access control: Select ADRs; create repository, environments, auth, users, roles, permissions, audit foundation, design system, and CI.

#### PHASE-003 - implementation_phase [P0 / accepted]

Planning core: Implement worksites, activities, employees, skills, absences, assignments, conflicts, draft/publish, confirmations, notifications, and calendar views.

#### PHASE-004 - implementation_phase [P0 / accepted]

Resources and working time: Implement unique resources, reservations, failures, damage reports, files, time start/stop, approval/correction, and audit.

#### PHASE-005 - implementation_phase [P1 / accepted]

Extended release functions: Implement PWA install/offline cache, saved filters, exports, profile images, voice transcription, routing, and CSV import. This phase also delivers worksite weather through the external weather adapter and bounded cache.

#### PHASE-006 - implementation_phase [P0 / accepted]

Pilot and production hardening: Run pilot, measure success, complete retention/privacy review, restore test, security testing, observability, and production release gate.

### 19. Atomic Task Breakdown

#### TASK-001 - atomic_task [P0 / accepted]

Prepare clickable prototype and usability script for journeys 1-10. Phase: PHASE-001. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-002 - atomic_task [P0 / accepted]

Run prototype sessions and record findings, severity, and approved UX changes. Phase: PHASE-001. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-003 - atomic_task [P0 / accepted]

Decide and document required ADRs and repository validation commands. Phase: PHASE-002. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-004 - atomic_task [P0 / accepted]

Create project skeleton, environment separation, CI, migrations, and test infrastructure. Phase: PHASE-002. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-005 - atomic_task [P0 / accepted]

Implement authentication, invitation, password reset, session revocation, and account lifecycle. Phase: PHASE-002. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-006 - atomic_task [P0 / accepted]

Implement roles, permissions, role preview, sensitive-right warnings, and server-side authorization. Phase: PHASE-002. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-007 - atomic_task [P0 / accepted]

Implement append-only audit service and correlation IDs. Phase: PHASE-002. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-008 - atomic_task [P0 / accepted]

Implement employees, skills, capacity, profile images, and avatar pool. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-009 - atomic_task [P0 / accepted]

Implement worksites, activity catalog, required fields, notes, and attachments. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-010 - atomic_task [P0 / accepted]

Implement assignments, time ranges, move/swap interactions, and four-week query model. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-011 - atomic_task [P0 / accepted]

Implement conflict engine with block/warn/override semantics. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-012 - atomic_task [P0 / accepted]

Implement draft, publish, versioning, weekly confirmation, changed-appointment confirmation, rejection, reminder, and escalation. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-013 - atomic_task [P0 / accepted]

Implement absence requests, approval, sickness, and scoped visibility. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-014 - atomic_task [P0 / accepted]

Implement week/month calendars, role-scoped filters, and personal saved filters. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-015 - atomic_task [P0 / accepted]

Implement notification outbox, email adapter, in-app center, and global messages. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-016 - atomic_task [P0 / accepted]

Implement resource register, configurable attributes, reservations, conflict propagation, block, and release. Phase: PHASE-004. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-017 - atomic_task [P0 / accepted]

Implement damage reporting, photos, voice capture, transcription review, and audit history. Phase: PHASE-004. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-018 - atomic_task [P0 / accepted]

Implement time start/stop, 10-hour prompt, pending approval, correction, and employee notifications. Phase: PHASE-004. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-019 - atomic_task [P0 / accepted]

Implement protected file upload/download, compression, retention hooks, and malware scanning adapter. Phase: PHASE-004. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-020 - atomic_task [P1 / accepted]

Implement PWA installation and authorized read-only offline cache with stale indicator. Phase: PHASE-005. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-021 - atomic_task [P1 / accepted]

Implement PDF/print export preserving authorization scope. Phase: PHASE-005. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-022 - atomic_task [P1 / accepted]

Implement private route origin and routing adapter with privacy controls. Phase: PHASE-005. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-023 - atomic_task [P1 / accepted]

Implement bounded CSV import preview and commit workflow. Phase: PHASE-005. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-024 - atomic_task [P0 / accepted]

Implement metrics, structured logs, health checks, job dashboards, and alerting. Phase: PHASE-006. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-025 - atomic_task [P0 / accepted]

Execute security, accessibility, browser, performance, backup-restore, and pilot acceptance tests. Phase: PHASE-006. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-026 - atomic_task [P0 / accepted]

Complete production data-flow review, retention decisions, runbooks, and release approval. Phase: PHASE-006. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.

#### TASK-027 - atomic_task [P1 / accepted]

Implement normalized worksite coordinates, weather adapter, bounded cache, today/next-day weather card, freshness and failure states, provider observability, and tests. Phase: PHASE-005. Inputs: approved PRD and weather decisions. Prohibit automatic safety or publication blocking unless separately approved.

### 20. Acceptance Criteria

#### AC-001 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given an invited user, when the invitation is accepted, then the user can sign in; after deactivation all sessions are rejected.

#### AC-002 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given a user profile, when an authorized admin assigns a role, then exactly one active role is stored and effective.

#### AC-003 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given an administrator edits a role, when permissions are saved, then the new permission set is enforced on the next authorized request and audited.

#### AC-004 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given an employee requests unrelated worksite or coworker data, when authorization is evaluated, then the request is denied even if the client attempts a direct API call.

#### AC-005 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given authorized calendar data, when filters are applied, then only matching and permitted records are shown in week or month view.

#### AC-006 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given a saved filter, when it is restored after the role loses access, then inaccessible data is not returned.

#### AC-007 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given a worksite draft lacks name, location, employee, or activity, when publication is attempted, then publication is blocked with field-level guidance.

#### AC-008 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given the activity form, when users select multiple labels and open info, then selections persist and the long descriptions appear only in the info surface.

#### AC-009 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given two worksites on one day, when an employee is assigned non-overlapping exact times, then both assignments are accepted and shown chronologically.

#### AC-010 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given a draft plan, when an employee opens the app before publication, then the draft is invisible; after authorized publication it is visible.

#### AC-011 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given a published week, when the employee confirms it, then all included assignments are accepted; a later material change reopens only that appointment.

#### AC-012 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given an employee selects reject, when no category or free-text reason is provided, then submission is blocked; after submission authorized reviewers see the reason.

#### AC-013 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given a relevant event, when processing completes, then an in-app notification and email delivery attempt exist and are traceable.

#### AC-014 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given a regular employee attempts a global message, when the API receives it, then it is denied; Administrator or Management can send it.

#### AC-015 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given a blocking conflict, when publication is requested, then it is rejected; warning-only conflicts remain visible and follow override policy.

#### AC-016 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given an enabled weekly budget, when assignments exceed it, then publication blocks unless an authorized override with reason is recorded.

#### AC-017 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given required worksite skills, when the planned team lacks one, then the gap is visible before publication.

#### AC-018 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given a vacation request, when Administrator or Management approves it, then it becomes active and conflicts with overlapping assignments.

#### AC-019 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given sickness is recorded, when calendar data is queried, then the employee is unavailable immediately and coworkers see no diagnosis.

#### AC-020 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given two employees overlap only on Thursday and Friday, when one is absent, then the other sees relevant absence only for Thursday and Friday.

#### AC-021 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given an assigned employee opens worksite notes, then they can read but not edit; Administrator can edit and changes are audited.

#### AC-022 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given an authorized upload, when type or size is invalid, then it is rejected; valid files are protected and attached to the target object.

#### AC-023 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given two similar lifts, when created, then each has a distinct identifier and can be reserved independently.

#### AC-024 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given a resource is blocked, when future reservations are queried, then every affected worksite shows a resource conflict.

#### AC-025 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given a safety-critical damage report, when no photo is attached, then submission is blocked; valid report stores reporter and timestamp.

#### AC-026 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given an employee attempts resource release, then it is denied; Administrator or Management can release only with reason and audit.

#### AC-027 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given an employee has a planned active assignment, when start is pressed, then one timer starts for that assignment; a second timer is rejected.

#### AC-028 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given a timer runs for ten hours, when threshold is reached, then email and in-app prompt are created while the timer remains running and flagged.

#### AC-029 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given a stopped entry, then it is pending approval; correction preserves original values and notifies the employee.

#### AC-030 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given an eight-hour time entry, when viewed or exported, then no wage, rate, invoice, or monetary amount is calculated.

#### AC-031 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given a private origin, when travel time is requested, then the employee sees an estimate and coworkers cannot retrieve the origin.

#### AC-032 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given assignments were loaded, when network is unavailable, then authorized cached details remain readable with last-sync indicator and no edit controls.

#### AC-033 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given a supported browser, when install is chosen, then the app can be launched from the home screen and core journeys remain functional.

#### AC-034 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given a valid profile image or allowed avatar, when saved, then it appears with name/initials; an admin can remove it.

#### AC-035 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given an export request, when generated, then the document contains only records the requester may see.

#### AC-036 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given a CSV import, when preview runs, then valid, changed, and invalid rows are shown before any commit.

#### AC-037 - acceptance_criterion [P0 / accepted]

Given/When/Then: Given a relevant mutation, when committed, then an audit record exists with actor, time, object, action, and required reason/diff.

#### AC-038 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given the planner opens four-week view, then rough future assignments are visible while weekly detail remains available.

#### AC-039 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given an assignment starts within 24 hours, when published, then it is allowed, visibly urgent, and unresolved response is shown for manual follow-up.

#### AC-040 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given an unanswered assignment reaches configured threshold, when reminder job runs, then employee and configured escalation recipients are notified once per policy.

#### AC-041 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given a voice note, when transcription returns, then the user must review and confirm editable text before the report is submitted.

#### AC-042 - acceptance_criterion [P1 / accepted]

Given/When/Then: Given only worksite activities change, when saved, then assigned employees are notified and the appointment confirmation remains accepted.

#### AC-043 - acceptance_criterion [P1 / accepted]

Given an employee has an assigned worksite with a valid location, when the current or next assignment is opened, then weather for today and the following day is shown with fetched-at time; if the provider fails, the app shows a marked last-known value or an unavailable state and still loads the assignment.

#### AC-044 - acceptance_criterion [P0 / accepted]

Given an authorized user archives an employee, when the operation completes, then the employee can no longer receive new assignments or sign in, while historical assignments, time records, approvals, damage reports, and audit references remain readable to authorized users.

### 21. Test Strategy

#### TEST-001 - test [P0 / accepted]

Unit tests for protected status transitions, conflict rules, capacity calculation, visibility scopes, and time state machine.

#### TEST-002 - test [P0 / accepted]

Authorization integration tests for every sensitive permission and direct object access attempt.

#### TEST-003 - test [P0 / accepted]

API contract tests for validation, idempotency, concurrency, errors, and pagination/filtering.

#### TEST-004 - test [P0 / accepted]

End-to-end tests for ten user journeys across Employee, Administrator, and Management roles.

#### TEST-005 - test [P0 / accepted]

Calendar and conflict tests for multi-worksite days, absence overlap, capacity, resource reservations, and short-notice changes.

#### TEST-006 - test [P0 / accepted]

Notification tests for outbox, email adapter, in-app delivery, retries, duplicates, reminder, and escalation.

#### TEST-007 - test [P0 / accepted]

File security tests for type spoofing, oversize, unauthorized access, deletion/archive, and malware adapter behavior.

#### TEST-008 - test [P0 / accepted]

Time tests for single timer, ten-hour prompt, stop, approval, correction, original-value retention, and no monetary conversion.

#### TEST-009 - test [P0 / accepted]

Offline tests for authorization, cache expiry, stale indicator, logout purge, and no offline mutation.

#### TEST-010 - test [P0 / accepted]

Accessibility and outdoor usability tests for touch size, contrast, text alternatives, color independence, and keyboard/screen-reader basics.

#### TEST-011 - test [P0 / accepted]

Browser matrix tests for current iOS Safari/Chrome, Android Chrome, and desktop Chrome/Edge/Safari.

#### TEST-012 - test [P0 / accepted]

Performance tests for week/month query, conflict validation, upload, export, and notification jobs at expected and expanded loads.

#### TEST-013 - test [P0 / accepted]

Backup restore test and environment isolation test before production.

#### TEST-014 - test [P0 / accepted]

Security tests for authentication, session revocation, authorization bypass, CSRF where applicable, injection, upload, rate limiting, and log redaction.

#### TEST-015 - test [P0 / accepted]

Pilot acceptance test with representative users; record completion, misclicks, help requests, and observed delays.

#### TEST-016 - test_strategy [P1 / accepted]

Weather contract, cache, time-zone, location-normalization, provider-timeout, stale-state, unavailable-state, duplicate-call, and authorization tests. Verify assignment retrieval remains available when the weather provider is down.

#### TEST-017 - test_strategy [P1 / accepted]

Pilot-load scenario with at least twelve active employees, three parallel worksites, one complete week, conflicts, confirmations, absences, and resources; values are a minimum acceptance dataset, not a system limit.

### 22. Observability and Monitoring

#### OBS-001 - observability [P1 / accepted]

Track authentication success/failure, session revocation, and authorization denials without logging secrets.

#### OBS-002 - observability [P1 / accepted]

Track plan publication, conflict blocks, overrides, confirmation response time, rejections, reminders, and escalations.

#### OBS-003 - observability [P1 / accepted]

Track notification delivery attempts, retries, permanent failures, and in-app unread counts.

#### OBS-004 - observability [P1 / accepted]

Track timer starts/stops, long-running timers, pending approvals, corrections, and duplicate command rejection.

#### OBS-005 - observability [P1 / accepted]

Track resource blocks, affected reservations, damage report completion, and release decisions.

#### OBS-006 - observability [P1 / accepted]

Track vendor usage and failures for email, maps, transcription, storage, and PDF generation.

#### OBS-007 - observability [P1 / accepted]

Provide health/readiness checks for web, API, database, queue/jobs, object storage, and adapters.

#### OBS-008 - observability [P1 / accepted]

Alert on failed backups, stuck outbox jobs, elevated error rate, repeated authorization anomalies, and storage exhaustion.

#### OBS-009 - observability [P1 / accepted]

Collect product metrics for weekly planning coverage, complete worksite information, unanswered assignments, avoidable conflicts, and pilot adoption.

#### OBS-010 - observability [P1 / accepted]

Monitor weather-provider latency, success rate, quota or rate-limit errors, cache hit ratio, stale responses, unavailable responses, and per-provider cost without logging unnecessary personal data.

### 23. Risk Register

#### RISK-001 - risk [P0 / accepted]

Scope overload: The broad MVP can delay value. Mitigation: enforce incremental release gates and do not start extended functions before planning core passes pilot criteria. Severity: high.

#### RISK-002 - risk [P0 / accepted]

Low adoption: Employees may ignore the app or timer. Mitigation: prototype tests, immediate personal value, large actions, and measured pilot. Severity: high.

#### RISK-003 - risk [P0 / accepted]

Authorization leakage: Configurable roles can expose coworker, absence, time, or draft data. Mitigation: atomic permissions, warnings, server enforcement, role preview, tests. Severity: high.

#### RISK-004 - risk [P0 / accepted]

Safety-critical resource release: Improper release can affect safety and liability. Mitigation: restricted roles, reason, audit, reauthentication, human policy. Severity: high.

#### RISK-005 - risk [P0 / accepted]

Notification failure: Unseen plan changes recreate the original problem. Mitigation: reliable outbox, delivery status, retries, in-app state, escalation. Severity: high.

#### RISK-006 - risk [P0 / accepted]

Data privacy: Absence, home origin, time, photos, and audit data may be overexposed. Mitigation: minimization, scoped authorization, retention policy, encryption. Severity: high.

#### RISK-007 - risk [P1 / accepted]

Offline staleness: Employees may act on stale data. Mitigation: read-only cache, last-sync label, expiry, online refresh prompts. Severity: medium.

#### RISK-008 - risk [P1 / accepted]

Vendor dependency: Maps/transcription/email cost or outage may impair non-core features. Mitigation: ports, fallbacks, quotas, monitoring. Severity: medium.

#### RISK-009 - risk [P1 / accepted]

Configuration drift: Too many editable fields/statuses can break consistency. Mitigation: protected core semantics, validation, archive instead of destructive changes. Severity: medium.

#### RISK-010 - risk [P1 / accepted]

Migration quality: Bad CSV data can corrupt planning. Mitigation: preview, row validation, idempotent import, rollback batch. Severity: medium.

#### RISK-011 - risk [P1 / accepted]

Timer errors: Forgotten stop or concurrent timers produce bad records. Mitigation: single timer, ten-hour prompt, approval and corrections. Severity: medium.

#### RISK-012 - risk [P0 / accepted]

Legal retention uncertainty: Retention periods are not yet legally approved. Mitigation: production blocker and configurable retention after review. Severity: high.

#### RISK-013 - risk [P0 / accepted]

Stale or inaccurate weather may be interpreted as authoritative. Mitigation: show timestamp and source state, use bounded cache, keep assignment data independent, and treat weather as advisory until explicit warning or blocking rules are approved. Severity: high.

### 24. Rollback and Checkpoints

#### ROLLBACK-001 - rollback [P0 / accepted]

Each phase ends with a tagged release, migration snapshot, test report, and human approval before the next phase.

#### ROLLBACK-002 - rollback [P0 / accepted]

Schema migrations are forward-compatible where possible and include tested rollback or restore procedure before production use.

#### ROLLBACK-003 - rollback [P0 / accepted]

Plan publication, import, and bulk configuration changes use transaction boundaries and batch identifiers for reversal or correction.

#### ROLLBACK-004 - rollback [P0 / accepted]

External adapters are feature-flagged so routing, transcription, exports, or email enhancements can be disabled without breaking planning core.

#### ROLLBACK-005 - rollback [P0 / accepted]

PWA cache versioning supports invalidation and logout purge; a bad service worker release can be rolled back.

#### ROLLBACK-006 - rollback [P0 / accepted]

Pilot release can fall back to prior planning process if critical planning, visibility, notification, or time integrity fails.

#### ROLLBACK-007 - rollback [P0 / accepted]

Production restore is rehearsed from backup and documented with target recovery objectives before launch.

### 25. Definition of Done

#### DOD-001 - definition_of_done [P0 / accepted]

All P0 requirements have mapped acceptance criteria, tests, and tasks with no unresolved product behavior.

#### DOD-002 - definition_of_done [P0 / accepted]

The seven core clickdummy journeys and ten final journeys pass stakeholder usability review.

#### DOD-003 - definition_of_done [P0 / accepted]

Server-side authorization tests pass for all sensitive permissions and scoped objects.

#### DOD-004 - definition_of_done [P0 / accepted]

Blocking conflicts cannot be published; warning and override behavior is audited.

#### DOD-005 - definition_of_done [P0 / accepted]

Notifications are reliable, observable, and do not silently lose plan changes.

#### DOD-006 - definition_of_done [P0 / accepted]

Damage, resource release, and time corrections preserve immutable history.

#### DOD-007 - definition_of_done [P0 / accepted]

Supported browser, accessibility, performance, offline, and file-upload tests pass agreed thresholds.

#### DOD-008 - definition_of_done [P0 / accepted]

Daily backup and restore test pass; environment isolation is demonstrated.

#### DOD-009 - definition_of_done [P0 / accepted]

Provider ADRs, data flow, retention/deletion policy, privacy information, and operational runbooks are approved before production.

#### DOD-010 - definition_of_done [P0 / accepted]

No payroll, invoice, geofencing, or continuous location tracking behavior is present.

#### DOD-011 - definition_of_done [P0 / accepted]

Repository-specific validation commands run successfully in CI and release evidence is stored.

#### DOD-012 - definition_of_done [P0 / accepted]

Pilot success metrics are reviewed and critical user feedback is resolved or explicitly deferred.

#### DOD-013 - definition_of_done [P1 / accepted]

Weather is visible for today and the following day on assigned worksite views, provider failure does not block assignment access, freshness is visible, and no automatic safety decision exists without approved rules.

#### DOD-014 - definition_of_done [P1 / accepted]

Employee lifecycle and the minimum pilot-load scenario are covered by automated and pilot acceptance tests.

### 26. Agent Handoff Instructions

#### CTX-101 - agent_instruction [P0 / accepted]

Use prd_report.md and prd_report.json as the product source of truth; do not infer behavior from UI mockups alone.

#### CTX-102 - agent_instruction [P0 / accepted]

Implement one bounded phase at a time and stop at every human review checkpoint.

#### CTX-103 - agent_instruction [P0 / accepted]

Do not invent persistent fields, permissions, status transitions, provider behavior, or retention periods.

#### CTX-104 - agent_instruction [P0 / accepted]

Keep domain rules independent from UI, controllers, persistence, and vendor adapters.

#### CTX-105 - agent_instruction [P0 / accepted]

Never bypass server-side authorization or expose data because a UI route is hidden.

#### CTX-106 - agent_instruction [P0 / accepted]

Do not add payroll, invoicing, continuous GPS, geofencing, full ERP, or unrestricted no-code capabilities.

#### CTX-107 - agent_instruction [P0 / accepted]

Require an ADR before adding a major provider, background job, or cross-module dependency.

#### CTX-108 - agent_instruction [P0 / accepted]

Add tests and migration/rollback evidence in the same change as each behavior.

#### CTX-109 - agent_instruction [P0 / accepted]

Stop and ask when a requirement conflicts with the repository, when a destructive migration is needed, or when an OPEN item affects the active phase.

#### CTX-110 - agent_instruction [P0 / accepted]

Do not infer weather safety thresholds, automatic work cancellation, publication blocking, or severe-weather escalation. Implement only the approved display, freshness, cache, and alert decisions; stop if these remain ambiguous.

## traceability_matrix

| Requirement | Acceptance | Tests                                  | Tasks                                                                | Risks                                  |
| ----------- | ---------- | -------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| FR-001      | AC-001     | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-002      | AC-002     | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-003      | AC-003     | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-004      | AC-004     | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-005      | AC-005     | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-006      | AC-006     | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-007      | AC-007     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-008      | AC-008     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-009      | AC-009     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-010      | AC-010     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-011      | AC-011     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-012      | AC-012     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-013      | AC-013     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-014      | AC-014     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-015      | AC-015     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-016      | AC-016     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-017      | AC-017     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-018      | AC-018     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-019      | AC-019     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-020      | AC-020     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-021      | AC-021     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-022      | AC-022     | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-023      | AC-023     | TEST-004, TEST-005, TEST-007, TEST-014 | TASK-016, TASK-017, TASK-019                                         | RISK-004, RISK-006                     |
| FR-024      | AC-024     | TEST-004, TEST-005, TEST-007, TEST-014 | TASK-016, TASK-017, TASK-019                                         | RISK-004, RISK-006                     |
| FR-025      | AC-025     | TEST-004, TEST-005, TEST-007, TEST-014 | TASK-016, TASK-017, TASK-019                                         | RISK-004, RISK-006                     |
| FR-026      | AC-026     | TEST-004, TEST-005, TEST-007, TEST-014 | TASK-016, TASK-017, TASK-019                                         | RISK-004, RISK-006                     |
| FR-027      | AC-027     | TEST-004, TEST-008                     | TASK-018                                                             | RISK-011, RISK-006                     |
| FR-028      | AC-028     | TEST-004, TEST-008                     | TASK-018                                                             | RISK-011, RISK-006                     |
| FR-029      | AC-029     | TEST-004, TEST-008                     | TASK-018                                                             | RISK-011, RISK-006                     |
| FR-030      | AC-030     | TEST-004, TEST-008                     | TASK-018                                                             | RISK-011, RISK-006                     |
| FR-031      | AC-031     | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-032      | AC-032     | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-033      | AC-033     | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-034      | AC-034     | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-035      | AC-035     | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-036      | AC-036     | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-037      | AC-037     | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| FR-038      | AC-038     | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| FR-039      | AC-039     | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| FR-040      | AC-040     | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| FR-041      | AC-041     | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| FR-042      | AC-042     | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| NFR-001     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-002     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-003     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-004     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-005     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-006     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-007     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-008     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-009     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-010     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-011     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-012     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-013     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-014     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-015     | -          | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| DATA-001    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-002    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-003    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-004    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-005    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-006    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-007    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-008    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-009    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-010    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-011    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-012    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-013    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-014    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-015    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-016    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-017    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-018    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-019    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-020    | -          | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| API-001     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-002     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-003     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-004     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-005     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-006     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-007     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-008     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-009     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-010     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-011     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-012     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-013     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-014     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-015     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-016     | -          | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| ARCH-001    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-002    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-003    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-004    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-005    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-006    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-007    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-008    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-009    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-010    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-011    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-012    | -          | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| SEC-001     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-002     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-003     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-004     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-005     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-006     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-007     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-008     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-009     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-010     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-011     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-012     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-013     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-014     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-015     | -          | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| FR-043      | AC-043     | TEST-016                               | TASK-027                                                             | RISK-013                               |
| FR-044      | AC-044     | TEST-002, TEST-003, TEST-017           | TASK-008                                                             | RISK-003, RISK-009                     |
| NFR-016     | AC-043     | TEST-016                               | TASK-027                                                             | RISK-008, RISK-013                     |
| NFR-017     | -          | TEST-012, TEST-015, TEST-017           | TASK-025                                                             | RISK-001, RISK-002                     |
| DATA-021    | AC-043     | TEST-016                               | TASK-027                                                             | RISK-013                               |
| API-017     | AC-043     | TEST-003, TEST-016                     | TASK-027                                                             | RISK-008, RISK-013                     |
| ARCH-013    | AC-043     | TEST-003, TEST-016                     | TASK-027                                                             | RISK-008, RISK-013                     |

## evidence_ledger

- **EV-001 / GOAL-001**: Central shared weekly view is the first business problem to solve. (confidence 5; sources: SRC-001, SRC-002)
- **EV-002 / FR-003**: Roles and permissions must be easily configurable by non-technical administrators. (confidence 5; sources: SRC-001, SRC-002)
- **EV-003 / FR-011**: Initial plan is confirmed per week; later changes are confirmed only for the changed appointment. (confidence 5; sources: SRC-002)
- **EV-004 / FR-015**: Double booking, approved absence, enabled capacity overflow, resource double reservation, and blocked resources prevent publication. (confidence 5; sources: SRC-002)
- **EV-005 / FR-025**: Every employee can report damage; serious damage requires a photo. (confidence 5; sources: SRC-001, SRC-002)
- **EV-006 / FR-029**: Time approval, correction, original-value preservation, and employee notification are accepted scope. (confidence 5; sources: SRC-002)
- **EV-007 / ARCH-001**: Domain logic must not depend on UI, transport, persistence, or vendor adapters. (confidence 5; sources: SRC-005)
- **EV-008 / SEC-013**: External providers process personal or operational data and require reviewed data flow before production. (confidence 4; sources: SRC-004, SRC-006)
- **EV-009 / FR-043**: Direct user requirement: every employee receives current and next-day weather at the worksite from a weather-service API. (confidence 5; sources: SRC-008)
- **EV-010 / FR-044**: Supplementary MVP target explicitly requires employees to be dynamically created; existing PRD already models Employee and account lifecycle. (confidence 5; sources: SRC-007, SRC-002)

## findings

### FIND-001 - scope / high

**Claim:** The accepted first release is broad rather than lean.
**Impact:** Extended functions can delay the planning core and user value.
**Recommendation:** Enforce phase gates; do not start Phase 5 until planning/resource/time core passes pilot criteria.
**Verification:** accepted mitigation in implementation phases

### FIND-002 - security / high

**Claim:** Configurable permissions and personal data make server-side authorization a release-critical control.
**Impact:** A UI-only permission model could expose employee, absence, time, or location data.
**Recommendation:** Implement atomic permission tests and object-scope authorization before real-data pilot.
**Verification:** specified; implementation evidence pending

### FIND-003 - architecture / medium

**Claim:** Provider and stack decisions are intentionally unresolved.
**Impact:** Implementation cannot safely begin without ADRs and repository validation commands.
**Recommendation:** Complete TASK-003 before foundation implementation.
**Verification:** open ADR dependency

### FIND-004 - privacy / high

**Claim:** Retention and deletion periods require legal and organizational review before production.
**Impact:** Unbounded retention creates privacy and operational risk.
**Recommendation:** Treat approved retention schedule as production release gate.
**Verification:** production blocker, not PRD blocker

### FIND-005 - scope_alignment / info

**Claim:** The supplementary MVP target does not override the approved PRD; compatible employee-lifecycle and pilot-scale precision can be added without removing broader approved scope.
**Impact:** The PRD remains the single source of truth while useful supplementary detail improves testability.
**Recommendation:** Keep the approved PRD scope and label supplementary values as acceptance scenarios rather than maxima.
**Verification:** verified_against_user_precedence_instruction

### FIND-006 - external_weather / high

**Claim:** Worksite weather is compatible with the assignment view but introduces freshness, provider-failure, warning, and false-authority risks.
**Impact:** Employees could rely on stale or incomplete weather information if source state and semantics are unclear.
**Recommendation:** Use a replaceable adapter, bounded cache, visible timestamp, graceful failure, and no automatic safety action until explicitly approved.
**Verification:** supported_with_open_implementation_decisions

## security_controls

**Risk level:** high

### Authentication

- **SEC-101**: Use invite-based accounts, secure password hashing, reset tokens, revocable sessions, and deactivation enforcement.

### Authorization

- **SEC-102**: Enforce one role per user plus atomic permissions and object-scope rules on the server for every protected endpoint.

### Secrets Management

- **SEC-103**: Store application, database, email, routing, transcription, and storage secrets only in environment secret management; never in repository, client, logs, or exports.

### Logging And Redaction

- **SEC-104**: Use structured audit and operational logs with correlation IDs; redact passwords, tokens, private origins, medical detail, voice content, and sensitive free text.

### Data Protection

- **SEC-105**: Use TLS, encryption at rest, protected object access, environment isolation, backup encryption, and retention/deletion jobs after legal approval.

### Abuse Cases

- **SEC-106**: Test role escalation, direct-object access, mass data export, abusive global messages, forged confirmations, unauthorized release, malicious uploads, timer manipulation, and origin leakage.

### Destructive Action Controls

- **SEC-107**: Prefer deactivate/archive; require confirmations and audit for role changes, resource release, time corrections, imports, and other high-impact actions.

### Security Tests

- **TEST-101**: Run automated auth/authz, session, upload, injection, rate-limit, CSRF where applicable, log-redaction, and dependency security tests before pilot and release.

### Privacy Controls

- **SEC-108**: Apply data minimization, purpose limitation, worksite/time-scoped coworker visibility, private-origin isolation, no diagnosis display, and no continuous tracking.

### Human Review Checkpoints

- **SEC-109**: Management and technical reviewer approve permission matrix, safety release policy, provider data flows, retention schedule, restore test, and production security report.

## machine_readable_json

See `prd_report.json`.

## agent_handoff

**Objective:** Implement the Arboscus Teamplaner in the approved phases, preserving product scope, authorization, traceability, and release gates.

**Allowed files/modules**

- MISSING: repository not supplied. During TASK-003 define allowed modules per phase.
- docs/prd/**
- docs/adr/**
- tests/** and implementation modules explicitly assigned to the active phase.

**Prohibited files/modules**

- Unrelated repositories or modules
- Production secrets or credential files
- Historical data outside approved migrations

**Prohibited actions**

- Do not bypass authorization.
- Do not invent core statuses, data schema, permissions, or provider behavior.
- Do not add payroll, invoicing, continuous GPS, geofencing, or full ERP scope.
- Do not perform destructive migrations without approved rollback.
- Do not log private origins, medical details, credentials, or sensitive free text.
- Do not create automatic weather-based work cancellation, planning blocks, or safety decisions without explicit approved requirements.

**Validation commands**

- `python /home/oai/skills/ai-native-prd-architect/scripts/validate_prd_output.py prd_report.json`
- `MISSING: repository-specific lint command`
- `MISSING: repository-specific type-check command`
- `MISSING: repository-specific unit/integration/e2e commands`

**Stop conditions**

- Repository or stack is not selected.
- A requirement conflicts with existing architecture.
- A persistent schema change is not covered by this PRD or an ADR.
- A protected workflow or authorization rule is ambiguous.
- A new external provider or background job is proposed without ADR.
- A destructive migration or production data action is required.
- Weather fields, refresh policy, warning channels, or safety semantics are required but remain undecided.

**Human review checkpoints**

- After clickdummy testing
- After ADR and architecture package
- Before each phase merge
- Before real personal data pilot
- After backup restore and security test
- Before production release

## quality_gate_report

- **Precision Gate - PASS**: Core behavior uses stable IDs, explicit states, and observable outcomes.
- **Missing-Information Gate - PASS**: PASS: Remaining provider, retention, metrics, and weather-detail decisions are explicitly listed and do not alter the accepted high-level product requirement.
- **Evidence Gate - PASS**: Central requirements map to user-provided sources or identified derived architecture constraints.
- **Architecture Gate - PASS**: Boundaries, ports, authorization, jobs, offline limits, and ADR requirements are explicit.
- **Data Gate - PASS**: Core entities, ownership, visibility, history, and lifecycle are specified; retention remains a production ADR/policy gate.
- **Security Gate - PASS**: Authentication, authorization, privacy, uploads, abuse cases, destructive controls, tests, and human review are specified.
- **Sustainability Gate - PASS**: Right-sizing, query efficiency, bounded cache/media, job limits, and vendor cost visibility are included.
- **Agent Executability Gate - PASS**: Phases, atomic tasks, stop conditions, and missing repository commands are explicit; implementation starts with ADR task.
- **Testability Gate - PASS**: Every functional requirement has a mapped Given/When/Then criterion and test strategy.
- **Artifact Gate - PASS**: Mandatory Markdown and JSON artifacts are generated; SARIF is not applicable because no code findings exist.
- **Release Gate - PASS**: PRD can be released as product source of truth; production remains gated by listed technical and legal checkpoints.

**Overall:** PASS

## open_questions

- **OQ-001**: Which repository, implementation stack, and repository-specific validation commands will be used? (blocks product release: false)
- **OQ-002**: Which EU hosting, database, object storage, authentication, email, routing, transcription, PDF, monitoring, and weather providers are selected? (blocks product release: false)
- **OQ-003**: Which legally reviewed retention and deletion periods apply to each personal-data and uploaded-file category? (blocks product release: false)
- **OQ-004**: Which pilot baselines and target values define success for planning effort, confirmation, conflict reduction, information quality, and adoption? (blocks product release: false)
- **OQ-005**: Should weather be shown only to assigned employees, or also to planners for every visible worksite and unassigned future worksite? (blocks product release: false)
- **OQ-006**: Which weather values are mandatory: condition, temperature, precipitation probability and amount, wind, gusts, severe-warning status, or additional values? (blocks product release: false)
- **OQ-007**: Should the app show a whole-day summary, the hours matching the assignment, or both for today and the following day? (blocks product release: false)
- **OQ-008**: What refresh interval, maximum stale age, and fallback behavior apply when the weather provider is unavailable? (blocks product release: false)
- **OQ-009**: Which severe-weather changes trigger only an in-app warning, and which also trigger email or escalation to Administration and Management? (blocks product release: false)
- **OQ-010**: Is weather strictly advisory, or may defined thresholds later warn, block publication, or recommend stopping work? (blocks product release: false)

## final_decision

**RELEASE**
