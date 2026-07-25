# Arboscus Teamplaner — Canonical AI-Native PRD

**Version:** 1.3-post-mvp-planning-economics-machine-rental  
**Status:** Product PRD released; post-MVP economics documented but not approved for MVP implementation.  
**Canonical repository:** `DYAI2025/Arborga`

## Meta

- Mode: `full_prd`
- Schema: `1.1`
- Date basis: `2026-07-23`

## Intake and Scope

**Goal:** Create the final PRD for the Arboscus Teamplaner MVP.

### In scope

- Full product PRD
- Traceability
- Security controls
- Architecture constraints
- Implementation phases
- Agent handoff
- Worksite weather for today and the following day
- Explicit employee lifecycle management
- Pilot acceptance scenario with at least twelve active employees and three parallel worksites
- Canonical repository DYAI2025/Arborga
- Supabase as selected database platform
- Assignment-scoped weather visibility without employee location tracking
- Hourly/daypart weather, air humidity, precipitation, wind/gusts, ozone, and official warnings
- Architecture, provider, retention, and pilot-metric recommendations
- Post-MVP specification for internal plan/actual cost transparency and machine-rental revenue tracking.
- Jira-ready future epic decomposition without adding the feature to the MVP implementation scope.

### Out of scope

- Implementation code
- Repository-specific implementation plan
- Provider contracting
- Legal certification
- Implementation of cost, revenue, rental, invoice, payroll, VAT, or accounting functionality in the MVP.
- General sales, customer order, invoicing, tax, payment, or bookkeeping workflows.

### Missing inputs

- Final application framework and deployment topology approval
- Final transactional email provider or existing corporate email integration
- Legally approved retention and deletion schedule
- Stakeholder-approved pilot baseline and target values
- Decision whether severe-warning changes additionally trigger browser push and/or email escalation
- Repository-specific lint, type-check, unit, integration, and end-to-end commands after code scaffold exists

### Assumptions

- The approved PRD remains the product source of truth.
- The canonical repository is https://github.com/DYAI2025/Arborga.git; its current default branch is master until explicitly renamed.
- Supabase is selected for the database; Supabase Auth and Storage are recommended but require an ADR decision.
- Weather visibility is derived from active/future assignments and worksite coordinates; no continuous employee GPS tracking is required or permitted.
- Weather remains advisory in MVP and cannot automatically cancel work, block publication, or issue a binding stop-work decision.
- Official warnings are sourced independently from forecast data so that provider forecasts cannot masquerade as official warnings.
- ASSUMPTION: Post-MVP economics is activated only by a separately approved phase and feature flag.

## Source Inventory

### SRC-001 — Initial product discovery and clarification conversation

- Type: `user_provided`
- Location: Chat conversation through 2026-07-23
- Supports: Business problem, users, workflows, scope decisions, UX principles, and acceptance decisions.
- Evidence: User statements consolidated in the attached product basis.
- Verification: accepted by product owner (confidence 5/5)

### SRC-002 — Arboscus Teamplaner MVP and PRD basis v6

- Type: `user_provided`
- Location: /mnt/data/arboscus_teamplaner_mvp_prd_basis_v6.md
- Supports: Consolidated facts, requirements, acceptance criteria, decisions, and release scope.
- Evidence: Sections 1-50, including normative requirements and final scope decisions.
- Verification: current source of truth for product intent (confidence 5/5)

### SRC-003 — Arboscus activity catalog

- Type: `user_provided`
- Location: User message and source basis activity section
- Supports: Initial selectable worksite activities and their informational descriptions.
- Evidence: Baumpflege, Baumkontrolle, Bodensanierung, Scha edlinge, Fassadenkletterei, Baumfaellungen, Baumsicherung, Diagnose, Sturmschaeden, Flaechenraeumung, Baubegleitung, Maschinenverleih.
- Verification: accepted (confidence 5/5)

### SRC-004 — AI-Native PRD Architect output contract

- Type: `standard_or_framework`
- Location: skills://ai-native-prd-architect
- Supports: Required PRD structure, traceability, security controls, and artifact schema.
- Evidence: Canonical 26 PRD sections and mandatory JSON schema.
- Verification: loaded (confidence 5/5)

### SRC-005 — Architecture quality gates

- Type: `standard_or_framework`
- Location: skills://ai-native-prd-architect/references/architecture-quality-gates.md
- Supports: Domain separation, external adapters, server-side authorization, ADR requirements.
- Evidence: Eight architecture quality gates.
- Verification: loaded (confidence 5/5)

### SRC-006 — Implementation-neutral architecture baseline

- Type: `derived_assumption`
- Location: This PRD
- Supports: A modular web application with service boundaries is a safe baseline until a repository and stack are selected.
- Evidence: Architecture constraints ARCH-001 through ARCH-012.
- Verification: requires ADR confirmation (confidence 3/5)

### SRC-007 — Supplementary MVP target document

- Type: `user_provided`
- Location: /mnt/data/mvp_ziel_der_mvp_soll_zun_chst_die_operative_planu.md
- Supports: Compatible supplementary precision for employee lifecycle and the pilot scenario of about twelve users and two to three parallel worksites.
- Evidence: MVP target lines 5-17 and success-metric section.
- Verification: accepted_as_supplement_only_where_compatible (confidence 5/5)

### SRC-008 — PRD precedence clarification and worksite weather requirement

- Type: `user_provided`
- Location: Current conversation, user message dated 2026-07-23T13:10:41Z
- Supports: The approved PRD remains authoritative; compatible supplements may be added; each employee shall receive current-day and next-day worksite weather from a weather-service API.
- Evidence: Direct user instruction in current conversation.
- Verification: authoritative_for_product_intent (confidence 5/5)

### SRC-009 — Repository, Supabase, weather-detail and warning decisions

- Type: `user_provided`
- Location: Current conversation, user message dated 2026-07-23T15:20:46Z
- Supports: Canonical repository, selected database, weather visibility, required fields, daypart display, warning prominence, and advisory-only MVP semantics.
- Evidence: User answer bundle in current conversation
- Verification: direct stakeholder decision (confidence 5/5)

### SRC-010 — DYAI2025/Arborga repository inspection

- Type: `repository_evidence`
- Location: https://github.com/DYAI2025/Arborga
- Supports: Repository exists, is accessible for push, contains an initial documentation commit, and currently reports master as default branch.
- Evidence: GitHub connector get_repo/search_commits/fetch_commit on 2026-07-23
- Verification: verified by GitHub connector (confidence 5/5)

### SRC-011 — Official provider documentation for Supabase, DWD, OpenWeather, routing, email, monitoring, hosting, PDF, and local transcription

- Type: `primary_external`
- Location: Official vendor and authority documentation reviewed 2026-07-23
- Supports: Provider capabilities, data regions, quotas, warning feeds, ozone fields, backup limitations, and replaceable-adapter recommendations.
- Evidence: Supabase Docs; DWD Open Data/CAP; OpenWeather One Call and Air Pollution; Hetzner Docs; HeiGIT/openrouteservice; Brevo; GlitchTip; Playwright; SYSTRAN/faster-whisper
- Verification: verified against current official documentation; contracting and DPA review pending (confidence 4/5)

### SRC-012 — German/EU retention and deletion baseline

- Type: `standard_or_framework`
- Location: GDPR storage limitation; BDSG §26; ArbZG §16; DIN EN ISO/IEC 27555:2025-09; BfDI guidance
- Supports: No single blanket retention period exists; deletion rules must be category-specific, necessity-based, documented, and legally reviewed; certain work-time records require at least two years.
- Evidence: Official law and standards references reviewed 2026-07-23
- Verification: legal sources verified; category schedule remains legal-review input (confidence 4/5)

### SRC-013 — Recommended implementation baseline for small mobile-first internal operations product

- Type: `derived_assumption`
- Location: Derived architecture recommendation in this PRD revision
- Supports: Modular TypeScript web app/PWA, Supabase, German app/worker hosting, local transcription worker, server-side provider adapters, bounded caches, and staged release.
- Evidence: Derived from accepted scope, provider documentation, security constraints, and expected small operating scale
- Verification: recommended, not yet accepted as final ADR (confidence 4/5)

### SRC-014 — Post-MVP cost and machine-rental economics decisions

- Type: `user_provided`
- Location: Current conversation, user message dated 2026-07-23T16:35:19Z
- Supports: Cost/revenue feature is excluded from MVP; initial access is Administrator and Management only; individual employee/subcontractor/resource rates are net and effective-dated; planned and actual costs plus machine-rental revenue are tracked without payroll, invoicing, VAT calculation, or accounting authority.
- Evidence: Direct stakeholder decision in current conversation.
- Verification: accepted_post_mvp_product_intent (confidence 5/5)

## PRD

### 1. Executive Summary

- **INFO-001** [accepted; p0] The Arboscus Teamplaner is a mobile-first, installable web application for planning employees, worksites, activities, skills, resources, absences, damage reports, and personal working time in a small tree-care company.
- **GOAL-001** [accepted; p0] Create one authoritative weekly planning view so every employee knows where, when, with whom, and on which activity they work.
- **INFO-002** [accepted; p0] The first release is a broad MVP delivered in increments: clickable prototype, planning and authorization core, resources and time, then extended release functions.
- **INFO-003** [accepted; p0] This PRD is implementation-ready at product level. Provider, hosting, retention, and repository-specific choices remain ADR items before production.
- **INFO-004** [accepted; p1] Version 1.1 adds advisory worksite weather for today and the following day, explicit employee lifecycle management, and a non-maximum pilot acceptance scenario of at least twelve active employees and three parallel worksites.
- **INFO-005** [accepted; p2] Version 1.3 documents a post-MVP planning-economics capability for effective-dated individual net cost rates, planned/actual cost transparency, and machine-rental revenue. It is explicitly excluded from the MVP implementation and production Definition of Done.

### 2. Problem Statement

- **INFO-010** [accepted; p0] Planning information is fragmented across Hero, Excel, messengers, paper calendars, and memory; employees sometimes ask shortly before work where they are assigned.
- **INFO-011** [accepted; p0] The business lacks a shared, current view of employee assignments, absences, skills, device failures, and worksite changes.
- **INFO-012** [accepted; p0] Resource failures and damage reports are not reliably captured and propagated to every affected future worksite.
- **INFO-013** [accepted; p1] Current software is perceived as expensive and insufficiently aligned with the concrete weekly planning workflow; exact Hero replacement scope is not a requirement of this release.

### 3. Goals and Non-Goals

- **GOAL-002** [accepted; p0] Reduce planning effort and avoid unclear or conflicting assignments.
- **GOAL-003** [accepted; p0] Give employees immediate mobile access to the current and next assignments, worksite briefing, team, activities, and resources.
- **GOAL-004** [accepted; p0] Make published plans, changes, confirmations, rejections, and escalation states visible and auditable.
- **GOAL-005** [accepted; p0] Support configurable roles, permissions, skills, worksite activities, resource attributes, and selected status values through a non-technical UI.
- **GOAL-006** [accepted; p0] Capture damage reports and resource unavailability early enough to influence planning.
- **GOAL-007** [accepted; p1] Provide personal start-stop time documentation and an approval/correction workflow without payroll calculations.
- **GOAL-008** [accepted; p0] Achieve high adoption through large touch targets, direct actions, visible options, and minimal interaction depth.
- **NOGOAL-001** [accepted; p0] MVP non-goal: no payroll, salary, honorarium, invoice, VAT/gross, payment, or accounting calculation. A separately approved post-MVP module may provide internal net planned/actual cost transparency and machine-rental revenue tracking without becoming the authoritative payroll, invoicing, tax, or bookkeeping system.
- **NOGOAL-002** [accepted; p0] No continuous GPS tracking, movement profiles, geofencing, or automatic location-based attendance.
- **NOGOAL-003** [accepted; p1] No complete ERP, warehouse, maintenance, procurement, or insurance-case management system.
- **NOGOAL-004** [accepted; p1] No complete replication of all Hero functions and no full historical Hero migration.
- **NOGOAL-005** [accepted; p0] No free-form no-code object builder; core domain objects and protected workflow semantics remain fixed.
- **GOAL-009** [accepted; p1] Give assigned employees location-specific weather context for today and the following day so they can prepare for worksite conditions.
- **GOAL-010** [accepted; p2] Post-MVP, give Administrator and Management a reproducible internal overview of planned costs, actual costs based on approved operational facts, and net machine-rental revenue while preserving strict separation from payroll, invoicing, VAT, and accounting.

### 4. Stakeholders and Users

- **INFO-020** [accepted; p0] Arboscus GmbH management is product sponsor and final business decision authority.
- **INFO-021** [accepted; p0] Administrator configures users, roles, permissions, worksites, activities, skills, resources, and planning data.
- **INFO-022** [accepted; p0] Management plans and publishes work, reviews rejections, approves absences and time entries, and releases blocked devices.
- **INFO-023** [accepted; p0] Operational employee views own assignments and team, confirms or rejects, starts/stops time, and reports damage.
- **INFO-024** [accepted; p1] Free employee uses the same operational experience; employment type is metadata, not a separate product role.
- **INFO-025** [accepted; p2] Bookkeeping may receive a configurable limited role but has no payroll or invoice workflow in this product.
- **INFO-026** [accepted; p0] Pilot reviewers must include management, administrator, operational employee, and preferably a less technical or new employee.
- **INFO-027** [accepted; p2] The post-MVP economics area is initially visible and manageable only to Administrator and Management. Employees receive no rate, cost, revenue, or aggregate economics access. Later access changes must use explicit atomic permissions.

### 5. Definitions and Domain Glossary

- **TERM-001** [accepted; p0] Worksite: a planned location with name, address, color, activities, briefing, team, resources, and time-bounded assignments.
- **TERM-002** [accepted; p0] Assignment: the central link between employee, worksite, start/end time, task, team role, status, and confirmation state.
- **TERM-003** [accepted; p0] Activity: selectable type of work performed at a worksite; at least one is required before publication.
- **TERM-004** [accepted; p0] Skill: configurable practical capability assigned to employees and required by worksites.
- **TERM-005** [accepted; p2] Qualification: formal certificate or evidence, excluded from deep MVP functionality and planned as a later extension.
- **TERM-006** [accepted; p0] Role: exactly one configurable permission bundle assigned to a user.
- **TERM-007** [accepted; p0] Permission: an atomic server-enforced capability such as viewing all worksites or correcting time.
- **TERM-008** [accepted; p0] Published week: a released weekly plan visible to affected employees and requiring collected weekly confirmation.
- **TERM-009** [accepted; p0] Material change: a change to time, worksite, or required presence that reopens confirmation only for the changed appointment.
- **TERM-010** [accepted; p0] Resource: uniquely identifiable device or vehicle with configurable attributes, availability, reservations, and damage state.
- **TERM-011** [accepted; p0] Damage report: structured report with object, worksite, reporter, time, description, severity, usability assessment, and attachments.
- **TERM-012** [accepted; p0] Protected core status: non-deletable workflow semantic used by system logic; labels or colors may be configured but meaning remains fixed.
- **TERM-013** [accepted; p0] Audit record: append-only record of relevant state changes, actor, time, previous value, new value, and reason.
- **TERM-014** [accepted; p2] Economic rate version: an individual, effective-dated net hourly or daily rate attached to one employee, subcontractor, machine, device, or vehicle; a new version replaces future applicability without overwriting historical versions.
- **TERM-015** [accepted; p2] Planned cost: a non-accounting projection derived from planned assignment or resource-reservation duration and the rate version effective for that planned interval.
- **TERM-016** [accepted; p2] Actual cost: a non-accounting internal value derived only from approved working time or confirmed resource usage and the rate version effective for the underlying interval.
- **TERM-017** [accepted; p2] Machine-rental revenue: net internal revenue overview derived from a confirmed rental interval and the machine-specific effective rental-rate version; it is not an invoice or accounting posting.

### 6. Assumptions, Missing Inputs, and Open Questions

- **OPEN-001** [needs_review; p0] OPEN QUESTION: Select the concrete EU hosting platform, database, and file storage through ADR-001 before implementation foundation is approved.
- **OPEN-002** [needs_review; p0] OPEN QUESTION: Select transactional email, maps/routing, and transcription providers, including data-processing terms and failure behavior.
- **OPEN-003** [needs_review; p0] OPEN QUESTION: Define legally reviewed retention and deletion periods for working time, absences, damage photos, audit logs, and private route origins before production.
- **OPEN-004** [missing; p0] MISSING: Repository, implementation stack, coding standards, and executable validation commands are not supplied; these must be defined in the implementation plan.
- **OPEN-005** [assumption; p1] ASSUMPTION: The initial operational scale is small, but the product must not encode a fixed employee or worksite limit.
- **OPEN-006** [needs_review; p1] OPEN QUESTION: Establish baseline and target values for planning effort, unanswered assignments, and avoidable planning conflicts during pilot preparation.
- **OPEN-007** [needs_review; p1] OPEN QUESTION: Define mandatory weather fields, temporal resolution, refresh interval, stale-data fallback, warning channels, visibility, and whether weather is advisory only.

### 7. Product Scope

- **INFO-030** [accepted; p0] In scope: individual accounts, invitation, password reset, revocable sessions, configurable roles and permissions.
- **INFO-031** [accepted; p0] In scope: weekly and monthly planning, four-week rolling horizon, assignments with exact start/end times, full-day and half-day shortcuts.
- **INFO-032** [accepted; p0] In scope: draft and publish workflow, weekly confirmation, per-change reconfirmation, rejection with mandatory reason, reminders and escalation.
- **INFO-033** [accepted; p0] In scope: worksites, required activities, briefing, notes, attachments, navigation, teams, skills, resources, and absence-aware visibility.
- **INFO-034** [accepted; p0] In scope: unique resources, reservations, cross-worksite failure propagation, damage reporting, blocking, and restricted release.
- **INFO-035** [accepted; p1] In scope: start-stop time, long-running timer reminder, approval/correction workflow, and personal overview.
- **INFO-036** [accepted; p1] In scope: profile images, avatar pool, saved filters, PDF/print export, voice notes with reviewable transcription, route duration, read-only offline cache, and limited CSV import.
- **INFO-037** [accepted; p1] Out of scope: formal certificate lifecycle, offline editing/synchronization, native mobile apps, SMS, full maintenance/procurement, and payroll/accounting.
- **INFO-038** [accepted; p1] Extended first-release scope includes a weather card for each assigned worksite, populated through an external weather-service adapter for today and the following day.
- **INFO-039** [accepted; p2] Post-MVP/Jira backlog: an optional Planning Economics and Machine Rental module with individual effective-dated net rates, planned and actual cost views, machine-rental revenue, period reports, authorization, audit, and exports. It is not part of Phase 1-6 or the MVP release gate.

### 8. User Journeys

- **JOURNEY-001** [accepted; p0] Employee signs in and sees the current or next assignment without searching.
- **JOURNEY-002** [accepted; p0] Employee opens the weekly plan, worksite, navigation, activities, team, resources, and operational notes.
- **JOURNEY-003** [accepted; p0] Employee confirms the published week or rejects an assignment with category and mandatory explanation.
- **JOURNEY-004** [accepted; p0] Planner builds a week using drag-and-drop or visible assignment cards, resolves blocking conflicts, and publishes.
- **JOURNEY-005** [accepted; p0] Planner changes a material appointment; only affected employees receive a new confirmation request for that appointment.
- **JOURNEY-006** [accepted; p0] Administrator creates a role, selects permissions, receives privacy warnings, and assigns it to a user.
- **JOURNEY-007** [accepted; p1] Employee starts and stops time from the planned assignment; management reviews or corrects it with audit history.
- **JOURNEY-008** [accepted; p0] Employee reports damage with photo or reviewed voice transcription; affected reservations are flagged and authorized users release the resource later.
- **JOURNEY-009** [accepted; p0] Employee submits vacation; administrator or management approves it, and planning blocks overlapping assignments.
- **JOURNEY-010** [accepted; p1] Employee reads previously loaded assignment information during temporary connectivity loss.
- **JOURNEY-011** [accepted; p1] An employee opens the current or next assignment and sees worksite weather for today and the following day, including source freshness and a clear stale or unavailable state.
- **JOURNEY-012** [accepted; p2] Post-MVP, an Administrator creates a future-effective individual rate version; Management compares planned costs with actual costs derived from approved time and confirmed resource usage, and reviews net machine-rental revenue for a selected period.

### 9. AI-Ready User Stories

- **STORY-001** [accepted; p0] As an employee, I want to see my next worksite immediately so I can prepare without asking by phone.
- **STORY-002** [accepted; p0] As a planner, I want to see employees, absences, skills, and resources in one weekly view so I can build feasible teams.
- **STORY-003** [accepted; p0] As an employee, I want to confirm the full published week and only reconfirm later changed appointments.
- **STORY-004** [accepted; p0] As an employee, I want to reject an assignment with a reason so management can resolve the issue.
- **STORY-005** [accepted; p0] As an administrator, I want to create understandable roles and permissions without editing code.
- **STORY-006** [accepted; p0] As a team member, I want to see only coworkers relevant to my worksite and time period.
- **STORY-007** [accepted; p0] As a planner, I want unavailable or double-booked employees and resources to block publication.
- **STORY-008** [accepted; p0] As an employee, I want to report damage quickly with a photo or voice note.
- **STORY-009** [accepted; p0] As management, I want device release restricted and audited.
- **STORY-010** [accepted; p0] As an employee, I want a single large action to start and stop my working time.
- **STORY-011** [accepted; p0] As management, I want to approve or correct time while preserving the original record.
- **STORY-012** [accepted; p1] As an employee, I want navigation and estimated travel time without exposing my home location to coworkers.
- **STORY-013** [accepted; p1] As a user, I want saved filters and exports that never expand my data permissions.
- **STORY-014** [accepted; p1] As an administrator, I want to extend activities and resource attributes without creating new domain objects.
- **STORY-015** [accepted; p1] As an employee, I want already loaded assignments to remain readable during a network outage.
- **STORY-016** [accepted; p1] As an assigned employee, I want current-day and next-day weather for my worksite so that I can prepare clothing, equipment, and arrival decisions without leaving the app.
- **STORY-017** [accepted; p2] As Management, I want planned costs, approved actual costs, and machine-rental revenue separated by person, resource, worksite, day, week, and selected period so I can understand operational economics without using the app as accounting software.
- **STORY-018** [accepted; p2] As an Administrator, I want to create effective-dated individual net hourly or daily rate versions so future changes never silently rewrite historical calculations.

### 10. Functional Requirements

- **FR-001** [accepted; p0] Account lifecycle: Administrators can invite, activate, deactivate, and archive user accounts; users can set and reset passwords; active sessions are revocable.
- **FR-002** [accepted; p0] Single role assignment: Each user has exactly one role. Initial role templates are Employee, Administrator, and Management.
- **FR-003** [accepted; p0] Configurable permissions: Administrators can create, clone, edit, and deactivate roles and select atomic permissions in the UI.
- **FR-004** [accepted; p0] Scoped visibility: Server-side authorization limits employees to own assignments, assigned worksites, relevant team members, and permitted data.
- **FR-005** [accepted; p0] Calendar views and filters: Provide week as primary view, month as secondary view, and filters for worksite, day, week, employee, absence, skill, resource, damage status, confirmation status, and running time.
- **FR-006** [accepted; p1] Saved filters: Users can save and restore permitted personal calendar views without gaining additional data access.
- **FR-007** [accepted; p0] Worksite lifecycle: Authorized users create, edit, archive, and color-code worksites with required name, location, at least one employee, and at least one activity before publication.
- **FR-008** [accepted; p0] Activity catalog: Worksite activities are multi-select checkbox labels with optional information popups; administrators can add and deactivate activities.
- **FR-009** [accepted; p0] Assignment planning: Assignments support exact start/end time, full-day and half-day shortcuts, multiple worksites per day, moving, swapping, and additional team members.
- **FR-010** [accepted; p0] Draft and publication: Plans can be saved as drafts visible only to authorized roles; Administrator and Management can publish.
- **FR-011** [accepted; p0] Confirmation lifecycle: Initial publication requests one confirmation for the week; material later changes request confirmation only for changed appointments.
- **FR-012** [accepted; p0] Rejection workflow: Every employee can reject an assignment; category and free-text explanation are mandatory and visible to Administrator and Management.
- **FR-013** [accepted; p0] Notifications: Every relevant event produces both email and in-app notification; responses occur only inside the application.
- **FR-014** [accepted; p1] Global messages: Only Administrator and Management can send an organization-wide message.
- **FR-015** [accepted; p0] Conflict engine: Publication is blocked by overlapping assignments, approved absence, enabled capacity overflow, double-reserved resources, or blocked resources; other configured issues produce warnings.
- **FR-016** [accepted; p1] Capacity budget: An optional weekly hour budget can be set per employee; when active, exceeding it blocks publication unless Administrator or Management overrides with reason.
- **FR-017** [accepted; p0] Skills: Administrators maintain skills, assign them to employees, declare worksite skill needs, and view gaps.
- **FR-018** [accepted; p0] Absence workflow: Employees and planners can create absence entries; vacation requires Administrator or Management approval.
- **FR-019** [accepted; p0] Sickness workflow: Sickness creates immediate unavailability; coworkers see only relevant unavailability, not medical details.
- **FR-020** [accepted; p0] Team visibility: Employees see names and avatars of coworkers only for the same worksite and overlapping time unless their role grants broader access.
- **FR-021** [accepted; p1] Worksite notes: Administrator creates, edits, and deletes operational worksite notes; assigned employees can read them.
- **FR-022** [accepted; p1] Attachments: Worksites, resources, and damage reports accept authorized JPG, PNG, and PDF files up to 10 MB with mobile image compression.
- **FR-023** [accepted; p0] Resource register: Devices and vehicles are uniquely identifiable, support configurable attributes, status, availability, and worksite reservation.
- **FR-024** [accepted; p0] Resource impact propagation: A resource failure or block is stored centrally and flags every affected current and future worksite/reservation.
- **FR-025** [accepted; p0] Damage reporting: Every app user can submit a structured damage report; a heavy or safety-critical report requires at least one photo.
- **FR-026** [accepted; p0] Restricted device release: Only Administrator and Management can formally release a blocked or safety-critical resource, with reason and audit record.
- **FR-027** [accepted; p1] Time start/stop: Employees can start exactly one timer only from a planned assignment and stop it to create a time entry.
- **FR-028** [accepted; p1] Long-running timer: After ten hours, employee receives email and in-app confirmation prompt; the timer remains running and is visibly flagged.
- **FR-029** [accepted; p1] Time approval and correction: Completed entries move to pending approval; authorized roles approve, correct, or mark for clarification while preserving originals and notifying employee.
- **FR-030** [accepted; p0] MVP monetary boundary: time data in the MVP never produces wages, rates, fees, invoice values, VAT, gross amounts, payments, or accounting entries. Post-MVP calculations defined in FR-062 through FR-070 are implemented only in a separately approved phase.
- **FR-031** [accepted; p1] Navigation and travel time: Employee can open external navigation and optionally store a private personal origin for estimated travel time; coworkers cannot see it.
- **FR-032** [accepted; p1] Read-only offline access: Previously loaded current and upcoming assignments, worksite information, and needed contacts are readable offline with synchronization timestamp.
- **FR-033** [accepted; p1] Installable PWA: The responsive mobile-first application can be installed from supported browsers and used in app-like mode.
- **FR-034** [accepted; p1] Profile image and avatar pool: Employees can upload a profile image or choose an administrator-provided avatar; administrators can remove inappropriate images.
- **FR-035** [accepted; p1] PDF and print export: Authorized users export a print-ready weekly plan limited to their current visibility rights.
- **FR-036** [accepted; p1] Limited CSV import: Authorized users import active employees, skills, resources, and open worksites using preview and error reporting.
- **FR-037** [accepted; p0] Audit log: Relevant planning, authorization, absence, resource, damage, time, and configuration changes create append-only audit records.
- **FR-038** [accepted; p1] Four-week horizon: Planning supports a rolling four-week overview while keeping the operational week primary.
- **FR-039** [accepted; p1] Short-notice assignment: Assignments less than 24 hours before start can be published; missing response is visible for manual resolution.
- **FR-040** [accepted; p1] Reminder and escalation: Unanswered assignments trigger configurable reminder and escalation, initially after 24 hours.
- **FR-041** [accepted; p1] Voice note transcription: Damage reports accept voice notes; transcribed text must be shown for user review and explicit confirmation before submission.
- **FR-042** [accepted; p1] Worksite activity changes: Activity changes are audited and notify assigned employees; activity-only changes do not reopen attendance confirmation.
- **FR-043** [accepted; p0] Worksite weather visibility: A user sees weather only for a worksite to which the user has a visible assignment for today or the following day. Visibility is derived from assignment and worksite data; no employee device location or continuous GPS tracking is used. Users without a visible worksite assignment receive no worksite weather card.
- **FR-044** [accepted; p0] Employee lifecycle: Authorized users can create, edit, deactivate, and archive employee records. Historical assignments, time entries, approvals, damage reports, and audit records remain referentially intact.
- **FR-045** [accepted; p0] Weather detail: For today and the following day, the app shows weather condition, temperature, relative humidity, precipitation probability, expected precipitation amount, wind speed, maximum gusts, ozone forecast, and official warning status for the worksite area. Values are displayed in units appropriate for Germany and include source and fetched-at information.
- **FR-046** [accepted; p1] Daypart forecast: The full day is divided into configurable dayparts (recommended default: morning 05-08, forenoon 08-11, midday 11-14, afternoon 14-18, evening 18-22, night 22-05). Dayparts overlapping the assignment are highlighted. Each daypart aggregates temperature range, humidity range, maximum precipitation probability, precipitation sum, maximum wind and gust, maximum ozone, and active warning windows.
- **FR-047** [accepted; p0] Official warnings: DWD official warnings for the worksite municipality/district and directly intersecting warning area are shown prominently with official severity, validity window, event type, source, and update time. Thunderstorm, wind/gust, severe rain, heat, and UV warnings are included when available. A separate nearby/regional state may show relevant warnings outside the direct worksite warning area without presenting them as site-active.
- **FR-048** [accepted; p0] Advisory-only safety semantics: In MVP, weather and warning information is highly visible but informational. The system must not automatically cancel assignments, block publication, order work cessation, or replace Arboscus safety decisions. Any future automated threshold action requires a separate approved requirement, risk assessment, and ADR.
- **FR-049** [accepted; p1] Ozone presentation: Ozone is displayed as forecast concentration in µg/m³, not as an official local measurement. The UI distinguishes the 120 µg/m³ health target value from the official 180 µg/m³ information threshold and 240 µg/m³ alert threshold, and does not provide medical diagnosis or individualized medical advice.
- **FR-062** [accepted; p2] Post-MVP scope gate: Planning Economics and Machine Rental is documented for backlog/Jira but must not be implemented, enabled, or included in the MVP release Definition of Done. Activation requires a separate approved phase, migration plan, permission review, and feature flag.
- **FR-063** [accepted; p2] Economics authorization: Initially only Administrator and Management can view or manage rates, planned costs, actual costs, machine-rental revenue, reports, or exports. Employees receive no access. Future role expansion uses explicit server-enforced atomic permissions.
- **FR-064** [accepted; p2] Individual rates: Each employee, subcontractor, machine, device, or vehicle may have its own net hourly or daily cost rate. Rentable machines may additionally have an individual net hourly or daily rental-revenue rate. Role/type default rates are not required.
- **FR-065** [accepted; p2] Effective-dated history: Rates have valid-from and optional valid-to dates. A future change creates a new version and never overwrites historical use. Backdated corrections require explicit authorization, reason, impact preview, audit, and controlled recalculation.
- **FR-066** [accepted; p2] Planned costs: The system may calculate planned personnel/subcontractor costs from assignment duration and planned resource costs from reservation duration using the rate version effective for the planned interval.
- **FR-067** [accepted; p2] Actual costs: Personnel and subcontractor actual costs are derived only from approved time entries. Resource actual costs are derived only from confirmed usage/rental intervals. Pending, rejected, or unapproved facts do not enter actual-cost totals.
- **FR-068** [accepted; p2] Machine-rental revenue: For the machine-rental domain only, a confirmed rental interval produces a net revenue value using the machine-specific effective rental rate. Other revenue categories remain out of scope and belong to accounting or another system of record.
- **FR-069** [accepted; p2] Economics reporting and audit: Authorized users can compare planned cost, actual cost, and machine-rental revenue by person, resource, worksite, day, week, and selected period. Every rate change, backdated correction, calculation version, and export is audited; historical reports retain the applied rate-version reference.
- **FR-070** [accepted; p2] Net and accounting boundary: All economics values are stored and displayed as net amounts in EUR. The module does not calculate VAT, gross values, wages, salaries, invoices, payments, receivables, ledger entries, or tax obligations.

### 11. Non-Functional Requirements

- **NFR-001** [accepted; p0] Mobile-first usability: Primary operational journeys must work on smartphones with large touch targets and no precision clicking.
- **NFR-002** [accepted; p0] Immediate orientation: The first viewport shows current/next assignment, time, worksite, confirmation state, and one clear primary action.
- **NFR-003** [accepted; p0] Interaction economy: Common employee actions require minimal steps; unnecessary dropdowns and hidden menus are prohibited.
- **NFR-004** [accepted; p0] Accessible status communication: Color is always supplemented by text, icon, initials, or pattern; contrast and font sizes support outdoor use and color-vision differences.
- **NFR-005** [accepted; p1] Performance: On a supported mobile device and normal mobile connection, cached shell loads promptly and primary worksite/weekly views should reach interactive state within a target agreed during technical planning.
- **NFR-006** [accepted; p0] Reliability: Publishing, confirmations, time entries, damage reports, and resource blocks must be transactionally consistent and idempotent.
- **NFR-007** [accepted; p1] Browser support: Support current Safari and Chrome on iOS/Android and current Chrome, Edge, and Safari on desktop.
- **NFR-008** [accepted; p0] Security: Authentication, authorization, session revocation, upload protection, and audit logging are mandatory before pilot with real data.
- **NFR-009** [accepted; p0] Privacy: Collect only necessary employee, absence, route-origin, time, and damage data; no continuous tracking.
- **NFR-010** [accepted; p0] Maintainability: Domain logic, UI, persistence, background jobs, and vendor adapters remain separated and testable.
- **NFR-011** [accepted; p0] Configurability boundary: Administrators can change approved catalogs, fields, labels, and permissions without altering protected core objects or workflow semantics.
- **NFR-012** [accepted; p0] Backup and recovery: Daily backups and a tested restore procedure are required before production.
- **NFR-013** [accepted; p1] Offline transparency: Offline data is read-only and clearly shows last synchronization time and stale state.
- **NFR-014** [accepted; p0] Auditability: Sensitive state changes must preserve actor, timestamp, old value, new value, and required reason.
- **NFR-015** [accepted; p2] Scalability: No fixed technical limit is tied to the current employee or worksite count.
- **NFR-016** [accepted; p1] Weather freshness and resilience: Weather responses are cached for a configurable bounded period, show fetched-at time and provider attribution where required, never fabricate missing values, and degrade to a clearly marked last-known or unavailable state.
- **NFR-017** [accepted; p1] Pilot-load acceptance: The pilot test dataset includes at least twelve active employees and three parallel worksites without treating these values as technical maxima. Core week planning remains correct and usable at that load.
- **NFR-018** [proposed; p0] Weather refresh and call economy: Forecast and air-quality data are cached once per normalized worksite coordinate, never per employee. Recommended default is refresh before first daily use and at most every three hours while a current or next-day assignment exists; ozone may refresh every six hours. Official DWD warning data is polled centrally at most every ten minutes. Forecast older than six hours and warnings older than twenty minutes are marked stale.
- **NFR-019** [accepted; p0] Warning accessibility: Warning severity is not communicated by color alone. DWD level, event label, icon, validity, plain-language risk text, and source are visible. DWD severity colors remain yellow/orange/red/violet; red is reserved for official level-3 severe-weather warnings and violet for level 4.

### 12. Data Model and Core Entities

- **DATA-001** [accepted; p0] UserAccount: Identity, email, credential reference, status, one role, sessions, last login, and employee relation.
- **DATA-002** [accepted; p0] Role: Name, active state, permission set, protected/template indicator, audit metadata.
- **DATA-003** [accepted; p0] Permission: Stable code, plain-language description, sensitivity level, and domain scope.
- **DATA-004** [accepted; p0] Employee: Name, avatar/profile image, contact data, employment metadata, skills, weekly capacity, private origin reference, status.
- **DATA-005** [accepted; p0] Worksite: Name, identifier, address, coordinates/link, color, period, status, activities, briefing, tasks, notes, safety/access data.
- **DATA-006** [accepted; p0] ActivityType: Checkbox label, info description, active state, sort order, historical preservation.
- **DATA-007** [accepted; p0] Assignment: Employee, worksite, start/end, task, team role, status, publication version, confirmation state, change history.
- **DATA-008** [accepted; p0] AssignmentConfirmation: Scope (week or changed appointment), response, reason category, free text, respondent, timestamps.
- **DATA-009** [accepted; p0] Absence: Employee, type, start/end, request status, visibility, approver, timestamps.
- **DATA-010** [accepted; p0] Skill: Name, category, description, employee assignments, worksite requirements.
- **DATA-011** [accepted; p0] Resource: Unique identity, category, attributes, status, availability, active damage state.
- **DATA-012** [accepted; p0] ResourceReservation: Resource, worksite, start/end, state, conflict metadata.
- **DATA-013** [accepted; p0] DamageReport: Resource, worksite, reporter, observed time, description, suspected sequence, type, area, severity, usability, state.
- **DATA-014** [accepted; p0] Attachment: Object relation, type, size, storage key, uploader, timestamp, visibility, integrity metadata.
- **DATA-015** [accepted; p0] TimeEntry: Employee, assignment, date, start/end, duration, state, original values, correction chain.
- **DATA-016** [accepted; p0] TimeApproval: Time entry, reviewer, decision, reason, old/new values, timestamps.
- **DATA-017** [accepted; p0] Notification: Recipient, channel, event type, object relation, delivery state, read state, timestamps.
- **DATA-018** [accepted; p0] AuditRecord: Actor, action, object, old/new representation or diff, reason, timestamp, request correlation.
- **DATA-019** [accepted; p1] SavedFilter: Owner, view type, permitted filter configuration, name, timestamps.
- **DATA-020** [accepted; p1] PrivateRouteOrigin: Employee-owned encrypted or protected origin data, not exposed to coworkers or exports.
- **DATA-021** [accepted; p0] WeatherSnapshot: normalized worksite coordinates/geohash, provider, forecast issue/fetch time, valid time, timezone, daypart, condition, temperature min/max, relative humidity min/max, precipitation probability maximum, precipitation amount sum, wind speed maximum, gust maximum, ozone maximum, source attribution, status, expiry, and cache metadata. It contains no employee device location.
- **DATA-022** [accepted; p0] OfficialWeatherWarning: source authority, CAP identifier, version/update identifier, event type, official severity/level, onset, expiry, affected geometry or administrative area, instruction text, source attribution, fetched-at time, cancellation/update relation, direct-site match, and nearby/regional match.
- **DATA-023** [accepted; p2] EconomicRateVersion: subject type and ID, economic direction (cost or machine-rental revenue), unit (hour/day), net amount, currency EUR, valid-from, optional valid-to, status, creator, timestamps, and audit reference.
- **DATA-024** [accepted; p2] PlannedEconomicSnapshot: selected planning version and period, source assignment/reservation IDs, rate-version IDs, quantities/durations, category totals, and generated-at timestamp. It is derived and rebuildable.
- **DATA-025** [accepted; p2] ActualCostRecord: approved time-entry or confirmed resource-usage reference, effective rate-version reference, calculated net amount, calculation version, and audit link.
- **DATA-026** [accepted; p2] MachineRentalRecord: rentable resource, rental interval, state (planned/confirmed/cancelled), effective rental-rate version, calculated net revenue, and audit links. It is not an invoice.

### 13. API and Interface Requirements

- **API-001** [accepted; p0] Authentication and session API: Invite, activate, sign in, sign out, password reset, list/revoke sessions.
- **API-002** [accepted; p0] Users, roles, and permissions API: CRUD with authorization, role preview, impact warning, and last-admin protection.
- **API-003** [accepted; p0] Worksites and activities API: CRUD, required-field validation, activity catalog, notes, attachments, and archive.
- **API-004** [accepted; p0] Assignments and planning API: Query calendars, create/move/swap assignments, validate conflicts, draft, publish, change versions.
- **API-005** [accepted; p0] Confirmations API: Confirm week, reject appointment, reconfirm changed appointment, list pending/escalated responses.
- **API-006** [accepted; p0] Absence API: Create request, approve/reject vacation, record sickness, query role-scoped availability.
- **API-007** [accepted; p0] Skills API: Maintain catalog, assign employee skills, declare worksite requirements, compute gaps.
- **API-008** [accepted; p0] Resources and reservations API: Maintain resources, reserve time ranges, block/release, and expose affected worksites.
- **API-009** [accepted; p0] Damage API: Create report, upload evidence, update state, record release decision, retrieve audit trail.
- **API-010** [accepted; p0] Time API: Start/stop timer, list own time, pending approvals, approve/correct/clarify.
- **API-011** [accepted; p0] Notifications API: List/read in-app notifications and record delivery results; no email-side business response.
- **API-012** [accepted; p0] File API: Issue protected upload/download operations with type, size, malware, and access validation.
- **API-013** [accepted; p1] Routing adapter: Estimate route duration and produce external navigation link without exposing private origin.
- **API-014** [accepted; p1] Transcription adapter: Submit audio, receive transcript, delete or retain audio according to policy, require user review.
- **API-015** [accepted; p1] Export API: Generate role-filtered weekly PDF/print representation.
- **API-016** [accepted; p1] Import API: Validate, preview, and commit bounded CSV imports with row-level error output.
- **API-017** [accepted; p0] Forecast and air-quality adapter: Resolve current-day and next-day hourly forecast plus ozone for normalized worksite coordinates; normalize provider schemas into the internal WeatherSnapshot contract; expose freshness, units, attribution, provider errors, and quota state; support server-side caching and no per-user provider calls.
- **API-018** [accepted; p0] Official DWD warning adapter: Ingest DWD CAP/Open Data centrally, process updates and cancellations idempotently, and spatially associate warnings with worksite coordinates using warning geometry or municipality/district identifiers. Provider data is never fetched directly by mobile clients.
- **API-019** [accepted; p2] Economics rate administration API: authorized create/list/future-close/correct commands for individual effective-dated net rates, with overlap validation, idempotency, and audit.
- **API-020** [accepted; p2] Economics calculation/report API: authorized planned-versus-actual cost queries by period and dimension, always returning applied rate-version IDs, source facts, net currency, and calculation timestamp.
- **API-021** [accepted; p2] Machine-rental revenue API: authorized creation/confirmation/cancellation of rental intervals and net revenue queries, without invoice, tax, payment, or ledger side effects.

### 14. Architecture Constraints

- **ARCH-001** [accepted; p0] Domain independence: Domain rules must not depend on UI framework, HTTP controllers, database driver, email, maps, or transcription vendors.
- **ARCH-002** [accepted; p0] Module boundaries: Separate identity/access, planning, worksites, workforce, resources/damage, time, notifications, files, and reporting modules.
- **ARCH-003** [accepted; p0] Server-side authorization: Every protected query and mutation validates permission and object scope on the server.
- **ARCH-004** [accepted; p0] External ports: Email, routing, transcription, object storage, PDF generation, and monitoring are behind replaceable interfaces.
- **ARCH-005** [accepted; p0] Transactional publication: Plan publication, versioning, conflict validation, and confirmation requests use one consistent transaction or reliable outbox pattern.
- **ARCH-006** [accepted; p0] Idempotent commands: Publish, confirm, reject, start/stop timer, upload finalization, and notification jobs are idempotent.
- **ARCH-007** [accepted; p0] Read-only offline cache: Offline storage contains only authorized, previously loaded data and cannot mutate domain state.
- **ARCH-008** [accepted; p0] Append-only audit: Audit records cannot be modified or deleted by normal application workflows.
- **ARCH-009** [accepted; p0] Configuration boundary: Custom fields and catalogs extend predefined objects; they cannot create arbitrary executable workflows or bypass validation.
- **ARCH-010** [accepted; p0] Background job discipline: Reminder, escalation, email, transcription, export, and cleanup jobs specify retry limits, dead-letter behavior, and observability.
- **ARCH-011** [accepted; p0] Environment isolation: Development, test, and production use separate credentials, data stores, and storage buckets.
- **ARCH-012** [accepted; p0] ADR requirement: Hosting, database, object storage, email, maps, transcription, authentication, and observability choices require ADRs before implementation.
- **ARCH-013** [proposed; p0] Weather providers are accessed only through replaceable server-side adapters. Recommended MVP combination is OpenWeather One Call plus Air Pollution for forecast/ozone and DWD CAP Open Data as the authority for official German warnings. Domain and UI consume internal contracts; provider failure must not break assignment retrieval.
- **ARCH-014** [accepted; p0] Canonical repository: DYAI2025/Arborga is the only implementation repository. Documentation, ADRs, schema migrations, tests, application code, and deployment definitions are versioned there. The current default branch master should be renamed to main before implementation or explicitly retained through an ADR; no agent may assume the branch name.
- **ARCH-015** [proposed; p0] Selected data platform: Supabase Postgres in Central EU (Frankfurt) is the database baseline. Recommended adjacent services are Supabase Auth and private Supabase Storage with Row Level Security, while service-role keys remain server-only. Database backup and object backup are separate because database backups do not restore deleted Storage objects.
- **ARCH-016** [proposed; p1] Recommended runtime topology: a modular TypeScript mobile-first web/PWA application with server API/BFF plus a separate Python worker for local transcription and scheduled provider ingestion, deployed in a German EU region. Domain logic remains independent of Next.js/React, Supabase SDKs, workers, and provider adapters.
- **ARCH-017** [accepted; p2] Post-MVP Economics is a separate bounded module that consumes approved Planning, Time, and Resource facts through owned interfaces. It must not become the system of record for payroll, invoicing, VAT, payments, or bookkeeping.
- **ARCH-018** [accepted; p2] Historical reproducibility: calculations bind to immutable rate-version IDs effective at the source interval. Changing a future rate creates a new version; backdated corrections require explicit authorization, audit, impact preview, and controlled recalculation.

### 15. Security, Privacy, and Compliance

- **SEC-001** [accepted; p0] Credential security: Passwords are stored using an approved password-hashing mechanism; plaintext or reversible password storage is prohibited.
- **SEC-002** [accepted; p0] Session control: Sessions are revocable, bounded in lifetime, protected against fixation, and invalidated for deactivated users.
- **SEC-003** [accepted; p0] Authorization matrix: Permissions and object scope are enforced server-side; UI hiding is never treated as authorization.
- **SEC-004** [accepted; p0] Sensitive permission warnings: Granting access to other employees, working times, absences, drafts, audit data, or device release requires explicit warning and audit.
- **SEC-005** [accepted; p0] Private origin protection: Private route origins are not shown to coworkers, exports, logs, or general administrators without a separately justified permission.
- **SEC-006** [accepted; p0] Absence minimization: Coworkers receive only relevant unavailability for overlapping work, never diagnoses or medical details.
- **SEC-007** [accepted; p0] Upload controls: File type, size, content disposition, access, and malware risk are validated; direct public object URLs are prohibited.
- **SEC-008** [accepted; p0] Audit protection: Audit data is append-only for normal users and includes correlation data without logging secrets or sensitive free text unnecessarily.
- **SEC-009** [accepted; p0] Destructive controls: Deletion is replaced by deactivation/archive where historical planning, damage, time, or audit integrity is required.
- **SEC-010** [accepted; p0] Release restriction: Only Administrator and Management can release blocked resources; action requires reason and reauthentication if risk level is high.
- **SEC-011** [accepted; p0] Data encryption: Transport encryption is mandatory; provider-supported encryption at rest is required for database, files, backups, and private origins.
- **SEC-012** [accepted; p0] Backup protection: Backups are access-controlled, encrypted, monitored, and restoration-tested.
- **SEC-013** [accepted; p0] Vendor privacy: Email, maps, transcription, hosting, and storage providers require documented data flows and processing terms before production.
- **SEC-014** [accepted; p0] No continuous tracking: The system must not collect continuous employee location, geofence events, or movement profiles.
- **SEC-015** [accepted; p0] Human review: Permission templates, retention policy, production data flows, and safety-critical resource workflow receive human review before production.
- **SEC-016** [proposed; p0] Supabase access control: Every exposed table and private Storage bucket uses explicit RLS policies. Authorization data is not trusted from user-editable metadata. Service-role credentials are never shipped to clients and are restricted to backend jobs with auditable purpose.
- **SEC-017** [accepted; p0] Retention governance: Production requires a category-based deletion schedule approved by Arboscus and legal/data-protection review. The schedule follows storage limitation and necessity, documents start events, legal holds, backup expiry, and deletion evidence. DIN EN ISO/IEC 27555:2025-09 is used as a method framework, not as a source of fixed legal periods.
- **SEC-018** [proposed; p1] Voice privacy: Local transcription is recommended. Raw audio is private, not used to train external models, and is deleted after the user confirms the transcript or after a short configurable failure window. The transcript remains editable and must be confirmed before submission.
- **SEC-019** [accepted; p2] Commercial-data access: rate, cost, revenue, and economics-report endpoints enforce Administrator/Management access by default, explicit object scope, export authorization, and server-side denial for employees.
- **SEC-020** [accepted; p2] Economics audit and minimization: individual rates are confidential commercial/personnel data; logs and analytics must not expose amounts unnecessarily, and rate changes/backdated corrections require actor, reason, previous/new version, and impact audit.

### 16. Sustainability and GreenOps

- **SUS-001** [accepted; p2] Right-sized deployment: Select infrastructure proportional to a small organization; avoid unnecessary distributed services before measured need.
- **SUS-002** [accepted; p2] Efficient queries: Index assignment, worksite, employee, time range, reservation, notification, and audit queries used by calendars and conflict checks.
- **SUS-003** [accepted; p2] Bounded offline data: Cache only current and upcoming authorized data with explicit expiry and cleanup.
- **SUS-004** [accepted; p2] Media efficiency: Compress mobile images and apply retention rules to audio and generated PDFs.
- **SUS-005** [accepted; p2] Job efficiency: Batch reminders, exports, and cleanup work and cap retries to avoid unbounded background processing.
- **SUS-006** [accepted; p2] Vendor cost visibility: Track routing, transcription, email, storage, and export usage per environment to detect cost drift.
- **SUS-007** [accepted; p2] Weather calls use coordinate-and-time-window caching, request coalescing, and bounded refresh to avoid repeated external calls when several employees share the same worksite.

### 17. Context Engineering Artifacts

- **CTX-001** [accepted; p1] PRD source of truth: Store this PRD and JSON mirror in the repository under docs/prd/ before implementation.
- **CTX-002** [accepted; p1] Architecture decisions: Create ADRs for stack, hosting, auth, persistence, storage, email, routing, transcription, PDF, monitoring, and retention.
- **CTX-003** [accepted; p1] Permissions matrix: Maintain a machine-readable permission catalog with sensitivity classification and default role templates.
- **CTX-004** [accepted; p1] Domain glossary: Keep protected statuses, activity rules, conflict rules, and visibility semantics in version-controlled domain documentation.
- **CTX-005** [accepted; p1] API contracts: Publish OpenAPI or equivalent contracts for protected APIs before frontend/backend parallel implementation.
- **CTX-006** [accepted; p1] Test fixtures: Create deterministic fixtures for users, roles, worksites, activities, assignments, absences, resources, damage, and time.
- **CTX-007** [accepted; p1] Agent instructions: Add repository-specific AGENTS.md with allowed modules, validation commands, secrets rules, and stop conditions.
- **CTX-008** [accepted; p1] Decision log: Record product-scope changes and deferred items; agents must not silently promote deferred scope.
- **CTX-009** [proposed; p0] Repository ADR set under docs/adr in DYAI2025/Arborga, including stack, Supabase, RLS, hosting, email, routing, transcription, PDF, monitoring, weather/air quality, DWD CAP, backup/restore, retention, branch/CI, and provider data flow.

### 18. Implementation Phases

- **PHASE-001** [accepted; p0] Clickdummy and UX validation: Build clickable mobile and desktop planning prototype for core journeys; test with representative users; freeze interaction decisions.
- **PHASE-002** [accepted; p0] Foundation and access control: Select ADRs; create repository, environments, auth, users, roles, permissions, audit foundation, design system, and CI.
- **PHASE-003** [accepted; p0] Planning core: Implement worksites, activities, employees, skills, absences, assignments, conflicts, draft/publish, confirmations, notifications, and calendar views.
- **PHASE-004** [accepted; p0] Resources and working time: Implement unique resources, reservations, failures, damage reports, files, time start/stop, approval/correction, and audit.
- **PHASE-005** [accepted; p1] Extended release functions: Implement PWA install/offline cache, saved filters, exports, profile images, voice transcription, routing, and CSV import. This phase also delivers worksite weather through the external weather adapter and bounded cache.
- **PHASE-006** [accepted; p0] Pilot and production hardening: Run pilot, measure success, complete retention/privacy review, restore test, security testing, observability, and production release gate.
- **PHASE-02A** [proposed; p0] Architecture decision package: confirm repository branch policy, modular TypeScript/PWA stack, Supabase region/Auth/Storage/RLS, German app/worker hosting, transactional email, routing, local transcription, PDF generation, monitoring, forecast/ozone provider, DWD warning ingestion, backup topology, and retention governance before production-grade implementation.
- **PHASE-007** [accepted; p2] Post-MVP Planning Economics and Machine Rental: after the MVP is released and separately approved, implement permissions, effective-dated individual rates, planned/actual cost projections, confirmed machine-rental revenue, reporting, audit, migration, and feature-flagged rollout.

### 19. Atomic Task Breakdown

- **TASK-001** [accepted; p0] Prepare clickable prototype and usability script for journeys 1-10. Phase: PHASE-001. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-002** [accepted; p0] Run prototype sessions and record findings, severity, and approved UX changes. Phase: PHASE-001. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-003** [accepted; p0] Decide and document required ADRs and repository validation commands. Phase: PHASE-002. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-004** [accepted; p0] Create project skeleton, environment separation, CI, migrations, and test infrastructure. Phase: PHASE-002. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-005** [accepted; p0] Implement authentication, invitation, password reset, session revocation, and account lifecycle. Phase: PHASE-002. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-006** [accepted; p0] Implement roles, permissions, role preview, sensitive-right warnings, and server-side authorization. Phase: PHASE-002. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-007** [accepted; p0] Implement append-only audit service and correlation IDs. Phase: PHASE-002. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-008** [accepted; p0] Implement employees, skills, capacity, profile images, and avatar pool. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-009** [accepted; p0] Implement worksites, activity catalog, required fields, notes, and attachments. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-010** [accepted; p0] Implement assignments, time ranges, move/swap interactions, and four-week query model. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-011** [accepted; p0] Implement conflict engine with block/warn/override semantics. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-012** [accepted; p0] Implement draft, publish, versioning, weekly confirmation, changed-appointment confirmation, rejection, reminder, and escalation. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-013** [accepted; p0] Implement absence requests, approval, sickness, and scoped visibility. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-014** [accepted; p0] Implement week/month calendars, role-scoped filters, and personal saved filters. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-015** [accepted; p0] Implement notification outbox, email adapter, in-app center, and global messages. Phase: PHASE-003. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-016** [accepted; p0] Implement resource register, configurable attributes, reservations, conflict propagation, block, and release. Phase: PHASE-004. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-017** [accepted; p0] Implement damage reporting, photos, voice capture, transcription review, and audit history. Phase: PHASE-004. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-018** [accepted; p0] Implement time start/stop, 10-hour prompt, pending approval, correction, and employee notifications. Phase: PHASE-004. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-019** [accepted; p0] Implement protected file upload/download, compression, retention hooks, and malware scanning adapter. Phase: PHASE-004. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-020** [accepted; p1] Implement PWA installation and authorized read-only offline cache with stale indicator. Phase: PHASE-005. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-021** [accepted; p1] Implement PDF/print export preserving authorization scope. Phase: PHASE-005. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-022** [accepted; p1] Implement private route origin and routing adapter with privacy controls. Phase: PHASE-005. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-023** [accepted; p1] Implement bounded CSV import preview and commit workflow. Phase: PHASE-005. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-024** [accepted; p0] Implement metrics, structured logs, health checks, job dashboards, and alerting. Phase: PHASE-006. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-025** [accepted; p0] Execute security, accessibility, browser, performance, backup-restore, and pilot acceptance tests. Phase: PHASE-006. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-026** [accepted; p0] Complete production data-flow review, retention decisions, runbooks, and release approval. Phase: PHASE-006. Inputs: approved PRD and prior phase outputs. Tests and stop conditions are mandatory.
- **TASK-027** [accepted; p1] Implement normalized worksite coordinates, weather adapter, bounded cache, today/next-day weather card, freshness and failure states, provider observability, and tests. Phase: PHASE-005. Inputs: approved PRD and weather decisions. Prohibit automatic safety or publication blocking unless separately approved.
- **TASK-028** [proposed; p0] Create repository and platform ADRs in DYAI2025/Arborga: branch strategy, application stack, Supabase Frankfurt project, Auth/Storage/RLS approach, migrations, environment separation, secrets, CI validation commands, German hosting, workers, backup/restore, and provider ports. Stop before implementation if repository branch or service ownership is unresolved.
- **TASK-029** [proposed; p0] Implement assignment-scoped weather: geocode worksites once, cache forecast/ozone per worksite, ingest DWD CAP warnings centrally, aggregate dayparts, highlight assignment overlap, enforce visibility, display official severity and freshness, and preserve assignment availability on provider failure. No employee GPS and no automatic safety action.
- **TASK-030** [proposed; p1] Establish pilot measurement: collect two to four weeks of pre-pilot baseline data, configure metric definitions and dashboards, run a four-week pilot, compare weeks three and four with baseline, and obtain separate feedback from Management, Administration, and employees. Targets remain proposed until stakeholder approval.
- **TASK-031** [proposed; p0] Create and approve the retention matrix and automated deletion design for time records, absences, damage files, audit/security logs, notifications, raw audio, weather cache, profile media, private route origins, inactive accounts, and backups. Implement no production deletion job until legal/data-protection approval.
- **TASK-032** [accepted; p2] Create the Jira epic and detailed domain/permission specification for post-MVP Planning Economics and Machine Rental. Confirm rate units, source facts, report dimensions, feature flag, migration, and non-goals before code.
- **TASK-033** [accepted; p2] Implement effective-dated individual net rate administration with overlap protection, version history, Administrator/Management authorization, audit, migration, and tests.
- **TASK-034** [accepted; p2] Implement planned and actual cost calculation from assignments, reservations, approved time entries, and confirmed resource usage, preserving source and rate-version references.
- **TASK-035** [accepted; p2] Implement confirmed machine-rental intervals and net rental-revenue reporting without invoice, VAT, payment, customer-accounting, or ledger side effects.
- **TASK-036** [accepted; p2] Implement authorized economics dashboards/exports, observability, backdated-correction impact preview, security tests, reconciliation tests, feature-flag rollout, and rollback.

### 20. Acceptance Criteria

- **AC-001** [accepted; p0] Given/When/Then: Given an invited user, when the invitation is accepted, then the user can sign in; after deactivation all sessions are rejected.
- **AC-002** [accepted; p0] Given/When/Then: Given a user profile, when an authorized admin assigns a role, then exactly one active role is stored and effective.
- **AC-003** [accepted; p0] Given/When/Then: Given an administrator edits a role, when permissions are saved, then the new permission set is enforced on the next authorized request and audited.
- **AC-004** [accepted; p0] Given/When/Then: Given an employee requests unrelated worksite or coworker data, when authorization is evaluated, then the request is denied even if the client attempts a direct API call.
- **AC-005** [accepted; p0] Given/When/Then: Given authorized calendar data, when filters are applied, then only matching and permitted records are shown in week or month view.
- **AC-006** [accepted; p1] Given/When/Then: Given a saved filter, when it is restored after the role loses access, then inaccessible data is not returned.
- **AC-007** [accepted; p0] Given/When/Then: Given a worksite draft lacks name, location, employee, or activity, when publication is attempted, then publication is blocked with field-level guidance.
- **AC-008** [accepted; p0] Given/When/Then: Given the activity form, when users select multiple labels and open info, then selections persist and the long descriptions appear only in the info surface.
- **AC-009** [accepted; p0] Given/When/Then: Given two worksites on one day, when an employee is assigned non-overlapping exact times, then both assignments are accepted and shown chronologically.
- **AC-010** [accepted; p0] Given/When/Then: Given a draft plan, when an employee opens the app before publication, then the draft is invisible; after authorized publication it is visible.
- **AC-011** [accepted; p0] Given/When/Then: Given a published week, when the employee confirms it, then all included assignments are accepted; a later material change reopens only that appointment.
- **AC-012** [accepted; p0] Given/When/Then: Given an employee selects reject, when no category or free-text reason is provided, then submission is blocked; after submission authorized reviewers see the reason.
- **AC-013** [accepted; p0] Given/When/Then: Given a relevant event, when processing completes, then an in-app notification and email delivery attempt exist and are traceable.
- **AC-014** [accepted; p1] Given/When/Then: Given a regular employee attempts a global message, when the API receives it, then it is denied; Administrator or Management can send it.
- **AC-015** [accepted; p0] Given/When/Then: Given a blocking conflict, when publication is requested, then it is rejected; warning-only conflicts remain visible and follow override policy.
- **AC-016** [accepted; p1] Given/When/Then: Given an enabled weekly budget, when assignments exceed it, then publication blocks unless an authorized override with reason is recorded.
- **AC-017** [accepted; p0] Given/When/Then: Given required worksite skills, when the planned team lacks one, then the gap is visible before publication.
- **AC-018** [accepted; p0] Given/When/Then: Given a vacation request, when Administrator or Management approves it, then it becomes active and conflicts with overlapping assignments.
- **AC-019** [accepted; p0] Given/When/Then: Given sickness is recorded, when calendar data is queried, then the employee is unavailable immediately and coworkers see no diagnosis.
- **AC-020** [accepted; p0] Given/When/Then: Given two employees overlap only on Thursday and Friday, when one is absent, then the other sees relevant absence only for Thursday and Friday.
- **AC-021** [accepted; p1] Given/When/Then: Given an assigned employee opens worksite notes, then they can read but not edit; Administrator can edit and changes are audited.
- **AC-022** [accepted; p1] Given/When/Then: Given an authorized upload, when type or size is invalid, then it is rejected; valid files are protected and attached to the target object.
- **AC-023** [accepted; p0] Given/When/Then: Given two similar lifts, when created, then each has a distinct identifier and can be reserved independently.
- **AC-024** [accepted; p0] Given/When/Then: Given a resource is blocked, when future reservations are queried, then every affected worksite shows a resource conflict.
- **AC-025** [accepted; p0] Given/When/Then: Given a safety-critical damage report, when no photo is attached, then submission is blocked; valid report stores reporter and timestamp.
- **AC-026** [accepted; p0] Given/When/Then: Given an employee attempts resource release, then it is denied; Administrator or Management can release only with reason and audit.
- **AC-027** [accepted; p1] Given/When/Then: Given an employee has a planned active assignment, when start is pressed, then one timer starts for that assignment; a second timer is rejected.
- **AC-028** [accepted; p1] Given/When/Then: Given a timer runs for ten hours, when threshold is reached, then email and in-app prompt are created while the timer remains running and flagged.
- **AC-029** [accepted; p1] Given/When/Then: Given a stopped entry, then it is pending approval; correction preserves original values and notifies the employee.
- **AC-030** [accepted; p0] Given/When/Then: Given an eight-hour time entry, when viewed or exported, then no wage, rate, invoice, or monetary amount is calculated.
- **AC-031** [accepted; p1] Given/When/Then: Given a private origin, when travel time is requested, then the employee sees an estimate and coworkers cannot retrieve the origin.
- **AC-032** [accepted; p1] Given/When/Then: Given assignments were loaded, when network is unavailable, then authorized cached details remain readable with last-sync indicator and no edit controls.
- **AC-033** [accepted; p1] Given/When/Then: Given a supported browser, when install is chosen, then the app can be launched from the home screen and core journeys remain functional.
- **AC-034** [accepted; p1] Given/When/Then: Given a valid profile image or allowed avatar, when saved, then it appears with name/initials; an admin can remove it.
- **AC-035** [accepted; p1] Given/When/Then: Given an export request, when generated, then the document contains only records the requester may see.
- **AC-036** [accepted; p1] Given/When/Then: Given a CSV import, when preview runs, then valid, changed, and invalid rows are shown before any commit.
- **AC-037** [accepted; p0] Given/When/Then: Given a relevant mutation, when committed, then an audit record exists with actor, time, object, action, and required reason/diff.
- **AC-038** [accepted; p1] Given/When/Then: Given the planner opens four-week view, then rough future assignments are visible while weekly detail remains available.
- **AC-039** [accepted; p1] Given/When/Then: Given an assignment starts within 24 hours, when published, then it is allowed, visibly urgent, and unresolved response is shown for manual follow-up.
- **AC-040** [accepted; p1] Given/When/Then: Given an unanswered assignment reaches configured threshold, when reminder job runs, then employee and configured escalation recipients are notified once per policy.
- **AC-041** [accepted; p1] Given/When/Then: Given a voice note, when transcription returns, then the user must review and confirm editable text before the report is submitted.
- **AC-042** [accepted; p1] Given/When/Then: Given only worksite activities change, when saved, then assigned employees are notified and the appointment confirmation remains accepted.
- **AC-043** [accepted; p0] Given a user has a visible assignment for a worksite today or tomorrow, when the assignment or start view opens, then the worksite weather is visible; given the user has no visible assignment, then no worksite weather is returned. The result is based on assignment/worksite data and never requires employee GPS.
- **AC-044** [accepted; p0] Given an authorized user archives an employee, when the operation completes, then the employee can no longer receive new assignments or sign in, while historical assignments, time records, approvals, damage reports, and audit references remain readable to authorized users.
- **AC-045** [accepted; p0] Given valid forecast data, when a user opens today or tomorrow, then each day shows dayparts with condition, temperature, humidity, precipitation probability and amount, wind, gusts, ozone, warning state, source, and fetched-at time; assignment-overlapping dayparts are highlighted.
- **AC-046** [accepted; p1] Given multiple assigned employees share one normalized worksite, when they open weather within the cache window, then the system serves the same cached worksite snapshot and performs no duplicate provider request per employee.
- **AC-047** [accepted; p0] Given a DWD warning is active for the worksite area, when the app synchronizes, then it shows the official event, level, severity color plus text/icon, validity, source, and update time prominently. Level 3 is red and level 4 violet. A nearby warning is explicitly labelled regional/nearby rather than site-active.
- **AC-048** [accepted; p0] Given weather or warning data crosses any displayed threshold, when the data is processed, then the application may alert the user but does not cancel, block, reschedule, or issue a binding stop-work instruction in MVP.
- **AC-049** [accepted; p1] Given ozone forecast values, when displayed, then the unit is µg/m³, the value is labelled forecast, 120 is described as a health target value, 180 as the information threshold, and 240 as the alert threshold; no medical diagnosis is generated.
- **AC-062** [accepted; p2] Given the MVP release configuration, when any user accesses an economics route or API, then the feature is absent or disabled and no economics tables/calculations are required for MVP acceptance.
- **AC-063** [accepted; p2] Given an Employee role, when the user requests any rate, cost, revenue, report, or economics export, then the server returns access denied and no amount is leaked through UI, API, cache, export, log, or notification.
- **AC-064** [accepted; p2] Given an authorized Administrator or Management user, when an individual rate is created, then the rate belongs to exactly one person or resource, is net EUR, uses hour or day as unit, and does not inherit a role/type default.
- **AC-065** [accepted; p2] Given an existing rate used by a historical interval, when an Administrator creates a new rate effective in the future, then the historical report remains unchanged and future intervals use only the new version.
- **AC-066** [accepted; p2] Given planned assignments and resource reservations, when an authorized user opens a period report, then planned costs equal the applicable planned durations multiplied by the individual effective rate versions and include source references.
- **AC-067** [accepted; p2] Given approved time entries and confirmed resource usage, when actual costs are calculated, then only approved/confirmed facts contribute and pending or rejected records contribute zero.
- **AC-068** [accepted; p2] Given a confirmed machine-rental interval, when revenue is calculated, then the net amount uses the machine-specific effective rental rate and no invoice, VAT, payment, or accounting entry is created.
- **AC-069** [accepted; p2] Given an authorized report period, when the report is generated, then planned cost, actual cost, and machine-rental revenue are separately shown by supported dimension and every total can be traced to source facts and rate versions.
- **AC-070** [accepted; p2] Given any economics value or export, when it is rendered, then it is labelled net EUR and contains no VAT/gross, payroll, invoice, payment, receivable, ledger, or tax status.

### 21. Test Strategy

- **TEST-001** [accepted; p0] Unit tests for protected status transitions, conflict rules, capacity calculation, visibility scopes, and time state machine.
- **TEST-002** [accepted; p0] Authorization integration tests for every sensitive permission and direct object access attempt.
- **TEST-003** [accepted; p0] API contract tests for validation, idempotency, concurrency, errors, and pagination/filtering.
- **TEST-004** [accepted; p0] End-to-end tests for ten user journeys across Employee, Administrator, and Management roles.
- **TEST-005** [accepted; p0] Calendar and conflict tests for multi-worksite days, absence overlap, capacity, resource reservations, and short-notice changes.
- **TEST-006** [accepted; p0] Notification tests for outbox, email adapter, in-app delivery, retries, duplicates, reminder, and escalation.
- **TEST-007** [accepted; p0] File security tests for type spoofing, oversize, unauthorized access, deletion/archive, and malware adapter behavior.
- **TEST-008** [accepted; p0] Time tests for single timer, ten-hour prompt, stop, approval, correction, original-value retention, and no monetary conversion.
- **TEST-009** [accepted; p0] Offline tests for authorization, cache expiry, stale indicator, logout purge, and no offline mutation.
- **TEST-010** [accepted; p0] Accessibility and outdoor usability tests for touch size, contrast, text alternatives, color independence, and keyboard/screen-reader basics.
- **TEST-011** [accepted; p0] Browser matrix tests for current iOS Safari/Chrome, Android Chrome, and desktop Chrome/Edge/Safari.
- **TEST-012** [accepted; p0] Performance tests for week/month query, conflict validation, upload, export, and notification jobs at expected and expanded loads.
- **TEST-013** [accepted; p0] Backup restore test and environment isolation test before production.
- **TEST-014** [accepted; p0] Security tests for authentication, session revocation, authorization bypass, CSRF where applicable, injection, upload, rate limiting, and log redaction.
- **TEST-015** [accepted; p0] Pilot acceptance test with representative users; record completion, misclicks, help requests, and observed delays.
- **TEST-016** [accepted; p1] Weather contract, cache, time-zone, location-normalization, provider-timeout, stale-state, unavailable-state, duplicate-call, and authorization tests. Verify assignment retrieval remains available when the weather provider is down.
- **TEST-017** [accepted; p1] Pilot-load scenario with at least twelve active employees, three parallel worksites, one complete week, conflicts, confirmations, absences, and resources; values are a minimum acceptance dataset, not a system limit.
- **TEST-018** [accepted; p0] Official-warning tests: DWD CAP parsing, update/cancel lifecycle, municipality/district and geometry matching, direct versus nearby classification, timezone, severity mapping, stale detection, attribution, and malformed-feed resilience.
- **TEST-019** [accepted; p0] Weather privacy and authorization tests: assigned versus unassigned user visibility, planner permission scope, no employee GPS fields or requests, no private-origin leakage, no per-user provider calls, and no automatic planning/safety side effects.
- **TEST-020** [proposed; p0] Supabase security tests: RLS allow/deny matrix for every exposed table and private bucket, service-role isolation, signed URL expiry, inactive-user session invalidation, migration rollback, database restore, and independent object restore.
- **TEST-021** [accepted; p2] Economics authorization tests: Employee denial, Administrator/Management allow rules, direct-object access, exports, caches, aggregate leakage, and permission-change regression.
- **TEST-022** [accepted; p2] Rate temporal tests: non-overlap, boundary dates, hourly/day units, future versioning, historical stability, backdated correction approval, impact preview, concurrency, and idempotency.
- **TEST-023** [accepted; p2] Economic calculation tests: planned assignment/reservation costs, actual approved-time/confirmed-usage costs, machine-rental revenue, rounding, net EUR labels, source traceability, and report aggregation.
- **TEST-024** [accepted; p2] Scope-boundary tests: no VAT/gross, payroll, invoice, payment, ledger, or other revenue workflow; feature disabled in MVP; feature-flag rollback leaves planning/time/resource facts intact.

### 22. Observability and Monitoring

- **OBS-001** [accepted; p1] Track authentication success/failure, session revocation, and authorization denials without logging secrets.
- **OBS-002** [accepted; p1] Track plan publication, conflict blocks, overrides, confirmation response time, rejections, reminders, and escalations.
- **OBS-003** [accepted; p1] Track notification delivery attempts, retries, permanent failures, and in-app unread counts.
- **OBS-004** [accepted; p1] Track timer starts/stops, long-running timers, pending approvals, corrections, and duplicate command rejection.
- **OBS-005** [accepted; p1] Track resource blocks, affected reservations, damage report completion, and release decisions.
- **OBS-006** [accepted; p1] Track vendor usage and failures for email, maps, transcription, storage, and PDF generation.
- **OBS-007** [accepted; p1] Provide health/readiness checks for web, API, database, queue/jobs, object storage, and adapters.
- **OBS-008** [accepted; p1] Alert on failed backups, stuck outbox jobs, elevated error rate, repeated authorization anomalies, and storage exhaustion.
- **OBS-009** [accepted; p1] Collect product metrics for weekly planning coverage, complete worksite information, unanswered assignments, avoidable conflicts, and pilot adoption.
- **OBS-010** [accepted; p1] Monitor weather-provider latency, success rate, quota or rate-limit errors, cache hit ratio, stale responses, unavailable responses, and per-provider cost without logging unnecessary personal data.
- **OBS-011** [proposed; p0] Monitor official warning feed age, last successful DWD poll, active warning count by severity, CAP parse failures, update/cancel lag, direct/nearby matching failures, and user-visible stale states. Alert operations when the warning feed is older than twenty minutes.
- **OBS-012** [proposed; p1] Pilot metrics are measured with explicit numerator, denominator, source, and time window: planning effort, 24-hour confirmation rate, unresolved assignments, post-publication conflicts, information completeness, weekly adoption, in-app confirmation share, time-entry completion, change acknowledgement, support demand, and role-specific satisfaction.
- **OBS-013** [accepted; p2] When the post-MVP module is enabled, monitor rate-version changes, rejected overlaps, calculation failures, source/rate mismatches, report latency, export volume, unauthorized access attempts, backdated corrections, and feature-flag state without logging confidential amounts unless operationally necessary.

### 23. Risk Register

- **RISK-001** [accepted; p0] Scope overload: The broad MVP can delay value. Mitigation: enforce incremental release gates and do not start extended functions before planning core passes pilot criteria. Severity: high.
- **RISK-002** [accepted; p0] Low adoption: Employees may ignore the app or timer. Mitigation: prototype tests, immediate personal value, large actions, and measured pilot. Severity: high.
- **RISK-003** [accepted; p0] Authorization leakage: Configurable roles can expose coworker, absence, time, or draft data. Mitigation: atomic permissions, warnings, server enforcement, role preview, tests. Severity: high.
- **RISK-004** [accepted; p0] Safety-critical resource release: Improper release can affect safety and liability. Mitigation: restricted roles, reason, audit, reauthentication, human policy. Severity: high.
- **RISK-005** [accepted; p0] Notification failure: Unseen plan changes recreate the original problem. Mitigation: reliable outbox, delivery status, retries, in-app state, escalation. Severity: high.
- **RISK-006** [accepted; p0] Data privacy: Absence, home origin, time, photos, and audit data may be overexposed. Mitigation: minimization, scoped authorization, retention policy, encryption. Severity: high.
- **RISK-007** [accepted; p1] Offline staleness: Employees may act on stale data. Mitigation: read-only cache, last-sync label, expiry, online refresh prompts. Severity: medium.
- **RISK-008** [accepted; p1] Vendor dependency: Maps/transcription/email cost or outage may impair non-core features. Mitigation: ports, fallbacks, quotas, monitoring. Severity: medium.
- **RISK-009** [accepted; p1] Configuration drift: Too many editable fields/statuses can break consistency. Mitigation: protected core semantics, validation, archive instead of destructive changes. Severity: medium.
- **RISK-010** [accepted; p1] Migration quality: Bad CSV data can corrupt planning. Mitigation: preview, row validation, idempotent import, rollback batch. Severity: medium.
- **RISK-011** [accepted; p1] Timer errors: Forgotten stop or concurrent timers produce bad records. Mitigation: single timer, ten-hour prompt, approval and corrections. Severity: medium.
- **RISK-012** [accepted; p0] Legal retention uncertainty: Retention periods are not yet legally approved. Mitigation: production blocker and configurable retention after review. Severity: high.
- **RISK-013** [accepted; p0] Stale or inaccurate weather may be interpreted as authoritative. Mitigation: show timestamp and source state, use bounded cache, keep assignment data independent, and treat weather as advisory until explicit warning or blocking rules are approved. Severity: high.
- **RISK-014** [accepted; p0] Warning freshness: A once-daily weather fetch is inadequate for rapidly changing thunderstorms and gust warnings. Mitigation: separate forecast cache from centrally polled official warnings, visible freshness, stale alerting, and no provider dependency in assignment retrieval. Severity: critical for safety communication, while the app remains advisory.
- **RISK-015** [accepted; p0] False regional precision: A point forecast or broad district warning may be mistaken for exact local certainty. Mitigation: distinguish forecast, direct official warning area, and nearby/regional context; display source, validity and uncertainty; do not invent probabilities absent from the provider. Severity: high.
- **RISK-016** [proposed; p0] Supabase backup gap: Database backups do not include Storage object bytes. Mitigation: independent encrypted object backup and restore test, plus documented RPO/RTO and deletion propagation. Severity: high.
- **RISK-017** [accepted; p2] Commercial confidentiality: individual employee/subcontractor rates and rental economics could be exposed. Mitigation: default Administrator/Management access, server authorization, export control, redaction, and tests. Severity: high.
- **RISK-018** [accepted; p2] Historical drift: overwriting rates or recalculating history with current rates would corrupt comparisons. Mitigation: effective-dated immutable versions, applied-rate references, correction workflow, and reproducibility tests. Severity: high.
- **RISK-019** [accepted; p2] Accounting scope creep: internal overview may be mistaken for payroll, invoice, tax, or bookkeeping output. Mitigation: explicit net/non-accounting labels, no VAT/gross/payment/ledger fields, separate system-of-record boundary, and UI/export disclaimers. Severity: high.

### 24. Rollback and Checkpoints

- **ROLLBACK-001** [accepted; p0] Each phase ends with a tagged release, migration snapshot, test report, and human approval before the next phase.
- **ROLLBACK-002** [accepted; p0] Schema migrations are forward-compatible where possible and include tested rollback or restore procedure before production use.
- **ROLLBACK-003** [accepted; p0] Plan publication, import, and bulk configuration changes use transaction boundaries and batch identifiers for reversal or correction.
- **ROLLBACK-004** [accepted; p0] External adapters are feature-flagged so routing, transcription, exports, or email enhancements can be disabled without breaking planning core.
- **ROLLBACK-005** [accepted; p0] PWA cache versioning supports invalidation and logout purge; a bad service worker release can be rolled back.
- **ROLLBACK-006** [accepted; p0] Pilot release can fall back to prior planning process if critical planning, visibility, notification, or time integrity fails.
- **ROLLBACK-007** [accepted; p0] Production restore is rehearsed from backup and documented with target recovery objectives before launch.
- **ROLLBACK-008** [accepted; p2] The post-MVP economics module is feature-flagged and isolated. Rollback disables economics UI/jobs and derived projections without deleting or changing assignments, approved time, resource usage, rental source records, or audit history; schema rollback/restore is rehearsed before release.

### 25. Definition of Done

- **DOD-001** [accepted; p0] All P0 requirements have mapped acceptance criteria, tests, and tasks with no unresolved product behavior.
- **DOD-002** [accepted; p0] The seven core clickdummy journeys and ten final journeys pass stakeholder usability review.
- **DOD-003** [accepted; p0] Server-side authorization tests pass for all sensitive permissions and scoped objects.
- **DOD-004** [accepted; p0] Blocking conflicts cannot be published; warning and override behavior is audited.
- **DOD-005** [accepted; p0] Notifications are reliable, observable, and do not silently lose plan changes.
- **DOD-006** [accepted; p0] Damage, resource release, and time corrections preserve immutable history.
- **DOD-007** [accepted; p0] Supported browser, accessibility, performance, offline, and file-upload tests pass agreed thresholds.
- **DOD-008** [accepted; p0] Daily backup and restore test pass; environment isolation is demonstrated.
- **DOD-009** [accepted; p0] Provider ADRs, data flow, retention/deletion policy, privacy information, and operational runbooks are approved before production.
- **DOD-010** [accepted; p0] No payroll, invoice, geofencing, or continuous location tracking behavior is present.
- **DOD-011** [accepted; p0] Repository-specific validation commands run successfully in CI and release evidence is stored.
- **DOD-012** [accepted; p0] Pilot success metrics are reviewed and critical user feedback is resolved or explicitly deferred.
- **DOD-013** [accepted; p1] Weather is visible for today and the following day on assigned worksite views, provider failure does not block assignment access, freshness is visible, and no automatic safety decision exists without approved rules.
- **DOD-014** [accepted; p1] Employee lifecycle and the minimum pilot-load scenario are covered by automated and pilot acceptance tests.
- **DOD-015** [proposed; p0] Repository, branch policy, CI commands, Supabase Frankfurt project, RLS policy matrix, database/object backup paths, and environment ownership are documented and tested before real personal data is used.
- **DOD-016** [accepted; p0] Weather is assignment-scoped; all required weather/ozone fields and dayparts are visible; DWD warnings preserve official severity and are refreshed centrally; stale/outage states are clear; provider calls are cached per worksite; no GPS or automatic safety decision exists.
- **DOD-017** [accepted; p2] MVP release does not require or include economics functionality. The future module is done only after separate stakeholder approval, Jira scope, permission review, effective-date migration, mapped tests, security review, and evidence that no payroll/invoice/VAT/accounting side effects exist.

### 26. Agent Handoff Instructions

- **CTX-101** [accepted; p0] Use prd_report.md and prd_report.json as the product source of truth; do not infer behavior from UI mockups alone.
- **CTX-102** [accepted; p0] Implement one bounded phase at a time and stop at every human review checkpoint.
- **CTX-103** [accepted; p0] Do not invent persistent fields, permissions, status transitions, provider behavior, or retention periods.
- **CTX-104** [accepted; p0] Keep domain rules independent from UI, controllers, persistence, and vendor adapters.
- **CTX-105** [accepted; p0] Never bypass server-side authorization or expose data because a UI route is hidden.
- **CTX-106** [accepted; p0] Do not add payroll, invoicing, continuous GPS, geofencing, full ERP, or unrestricted no-code capabilities.
- **CTX-107** [accepted; p0] Require an ADR before adding a major provider, background job, or cross-module dependency.
- **CTX-108** [accepted; p0] Add tests and migration/rollback evidence in the same change as each behavior.
- **CTX-109** [accepted; p0] Stop and ask when a requirement conflicts with the repository, when a destructive migration is needed, or when an OPEN item affects the active phase.
- **CTX-110** [accepted; p0] Do not infer weather safety thresholds, automatic work cancellation, publication blocking, or severe-weather escalation. Implement only the approved display, freshness, cache, and alert decisions; stop if these remain ambiguous.
- **CTX-111** [accepted; p2] Do not implement FR-062 through FR-070, DATA-023 through DATA-026, API-019 through API-021, or PHASE-007 during the MVP unless the user explicitly starts and approves the post-MVP phase.
- **CTX-112** [accepted; p2] When the post-MVP phase is approved, keep Economics isolated, use effective-dated individual net rates, preserve historical rate references, enforce Administrator/Management access, and prohibit payroll, invoice, VAT, payment, ledger, and unrelated revenue functionality.

## Traceability Matrix

| Requirement | Sources                   | Acceptance             | Tests                                  | Tasks                                                                | Risks                                  |
| ----------- | ------------------------- | ---------------------- | -------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| FR-001      | SRC-002                   | AC-001                 | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-002      | SRC-002                   | AC-002                 | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-003      | SRC-002                   | AC-003                 | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-004      | SRC-002                   | AC-004                 | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-005      | SRC-002                   | AC-005                 | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-006      | SRC-002                   | AC-006                 | TEST-002, TEST-004, TEST-014           | TASK-005, TASK-006                                                   | RISK-003, RISK-006                     |
| FR-007      | SRC-002                   | AC-007                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-008      | SRC-002                   | AC-008                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-009      | SRC-002                   | AC-009                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-010      | SRC-002                   | AC-010                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-011      | SRC-002                   | AC-011                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-012      | SRC-002                   | AC-012                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-013      | SRC-002                   | AC-013                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-014      | SRC-002                   | AC-014                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-015      | SRC-002                   | AC-015                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-016      | SRC-002                   | AC-016                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-017      | SRC-002                   | AC-017                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-018      | SRC-002                   | AC-018                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-019      | SRC-002                   | AC-019                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-020      | SRC-002                   | AC-020                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-021      | SRC-002                   | AC-021                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-022      | SRC-002                   | AC-022                 | TEST-004, TEST-005, TEST-006           | TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015 | RISK-002, RISK-005, RISK-006           |
| FR-023      | SRC-002                   | AC-023                 | TEST-004, TEST-005, TEST-007, TEST-014 | TASK-016, TASK-017, TASK-019                                         | RISK-004, RISK-006                     |
| FR-024      | SRC-002                   | AC-024                 | TEST-004, TEST-005, TEST-007, TEST-014 | TASK-016, TASK-017, TASK-019                                         | RISK-004, RISK-006                     |
| FR-025      | SRC-002                   | AC-025                 | TEST-004, TEST-005, TEST-007, TEST-014 | TASK-016, TASK-017, TASK-019                                         | RISK-004, RISK-006                     |
| FR-026      | SRC-002                   | AC-026                 | TEST-004, TEST-005, TEST-007, TEST-014 | TASK-016, TASK-017, TASK-019                                         | RISK-004, RISK-006                     |
| FR-027      | SRC-002                   | AC-027                 | TEST-004, TEST-008                     | TASK-018                                                             | RISK-011, RISK-006                     |
| FR-028      | SRC-002                   | AC-028                 | TEST-004, TEST-008                     | TASK-018                                                             | RISK-011, RISK-006                     |
| FR-029      | SRC-002                   | AC-029                 | TEST-004, TEST-008                     | TASK-018                                                             | RISK-011, RISK-006                     |
| FR-030      | SRC-002                   | AC-030                 | TEST-004, TEST-008                     | TASK-018                                                             | RISK-011, RISK-006                     |
| FR-031      | SRC-002                   | AC-031                 | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-032      | SRC-002                   | AC-032                 | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-033      | SRC-002                   | AC-033                 | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-034      | SRC-002                   | AC-034                 | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-035      | SRC-002                   | AC-035                 | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-036      | SRC-002                   | AC-036                 | TEST-004, TEST-009, TEST-011, TEST-012 | TASK-020, TASK-021, TASK-022, TASK-023                               | RISK-007, RISK-008, RISK-010           |
| FR-037      | SRC-002                   | AC-037                 | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| FR-038      | SRC-002                   | AC-038                 | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| FR-039      | SRC-002                   | AC-039                 | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| FR-040      | SRC-002                   | AC-040                 | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| FR-041      | SRC-002                   | AC-041                 | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| FR-042      | SRC-002                   | AC-042                 | TEST-001, TEST-004, TEST-006, TEST-014 | TASK-007, TASK-012, TASK-015, TASK-017                               | RISK-005, RISK-009                     |
| NFR-001     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-002     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-003     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-004     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-005     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-006     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-007     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-008     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-009     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-010     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-011     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-012     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-013     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-014     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| NFR-015     | SRC-002, SRC-004          |                        | TEST-010, TEST-011, TEST-012, TEST-014 | TASK-003, TASK-004, TASK-024, TASK-025                               | RISK-001, RISK-002, RISK-003, RISK-006 |
| DATA-001    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-002    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-003    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-004    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-005    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-006    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-007    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-008    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-009    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-010    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-011    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-012    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-013    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-014    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-015    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-016    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-017    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-018    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-019    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| DATA-020    | SRC-002                   |                        | TEST-001, TEST-002, TEST-003           | TASK-003, TASK-004                                                   | RISK-003, RISK-006, RISK-009           |
| API-001     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-002     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-003     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-004     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-005     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-006     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-007     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-008     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-009     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-010     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-011     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-012     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-013     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-014     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-015     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| API-016     | SRC-002, SRC-005          |                        | TEST-003, TEST-014                     | TASK-003, TASK-004                                                   | RISK-003, RISK-005, RISK-008           |
| ARCH-001    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-002    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-003    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-004    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-005    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-006    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-007    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-008    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-009    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-010    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-011    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| ARCH-012    | SRC-005, SRC-006          |                        | TEST-001, TEST-003, TEST-014           | TASK-003, TASK-004                                                   | RISK-001, RISK-008, RISK-009           |
| SEC-001     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-002     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-003     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-004     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-005     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-006     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-007     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-008     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-009     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-010     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-011     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-012     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-013     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-014     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| SEC-015     | SRC-002, SRC-004          |                        | TEST-002, TEST-007, TEST-014           | TASK-003, TASK-005, TASK-006, TASK-019, TASK-025                     | RISK-003, RISK-004, RISK-006, RISK-012 |
| FR-043      | SRC-009                   | AC-043                 | TEST-019                               | TASK-029                                                             | RISK-015                               |
| FR-044      | SRC-007, SRC-002          | AC-044                 | TEST-002, TEST-003, TEST-017           | TASK-008                                                             | RISK-003, RISK-009                     |
| NFR-016     | SRC-008, SRC-005          | AC-043                 | TEST-016                               | TASK-027                                                             | RISK-008, RISK-013                     |
| NFR-017     | SRC-007                   |                        | TEST-012, TEST-015, TEST-017           | TASK-025                                                             | RISK-001, RISK-002                     |
| DATA-021    | SRC-008                   | AC-043                 | TEST-016                               | TASK-027                                                             | RISK-013                               |
| API-017     | SRC-008, SRC-005          | AC-043                 | TEST-003, TEST-016                     | TASK-027                                                             | RISK-008, RISK-013                     |
| ARCH-013    | SRC-005, SRC-008          | AC-043                 | TEST-003, TEST-016                     | TASK-027                                                             | RISK-008, RISK-013                     |
| FR-045      | SRC-009, SRC-011          | AC-045                 | TEST-016                               | TASK-029                                                             | RISK-013, RISK-014                     |
| FR-046      | SRC-009, SRC-013          | AC-045, AC-046         | TEST-016                               | TASK-029                                                             | RISK-014                               |
| FR-047      | SRC-009, SRC-011          | AC-047                 | TEST-018                               | TASK-029                                                             | RISK-014, RISK-015                     |
| FR-048      | SRC-009                   | AC-048                 | TEST-019                               | TASK-029                                                             | RISK-013                               |
| FR-049      | SRC-009, SRC-011          | AC-049                 | TEST-016                               | TASK-029                                                             | RISK-015                               |
| NFR-018     | SRC-009, SRC-011, SRC-013 | AC-046                 | TEST-016, TEST-018                     | TASK-029                                                             | RISK-014                               |
| NFR-019     | SRC-009, SRC-011          | AC-047                 | TEST-018                               | TASK-029                                                             | RISK-015                               |
| DATA-022    | SRC-009, SRC-011          | AC-047                 | TEST-018                               | TASK-029                                                             | RISK-014, RISK-015                     |
| API-018     | SRC-009, SRC-011          | AC-047                 | TEST-018                               | TASK-029                                                             | RISK-014                               |
| ARCH-014    | SRC-009, SRC-010          | AC-043                 | TEST-019                               | TASK-028                                                             |                                        |
| ARCH-015    | SRC-009, SRC-011, SRC-013 |                        | TEST-020                               | TASK-028                                                             | RISK-016                               |
| SEC-017     | SRC-012                   |                        | TEST-020                               | TASK-031                                                             | RISK-004                               |
| OBS-012     | SRC-009, SRC-013          |                        |                                        | TASK-030                                                             |                                        |
| DATA-023    | SRC-014                   | AC-065                 | TEST-022                               | TASK-033                                                             | RISK-018                               |
| DATA-025    | SRC-014                   | AC-067                 | TEST-023                               | TASK-034                                                             | RISK-018                               |
| DATA-026    | SRC-014                   | AC-068                 | TEST-023                               | TASK-035                                                             | RISK-019                               |
| API-019     | SRC-014                   | AC-063, AC-065         | TEST-021, TEST-022                     | TASK-033                                                             | RISK-017, RISK-018                     |
| API-020     | SRC-014                   | AC-066, AC-067, AC-069 | TEST-023                               | TASK-034, TASK-036                                                   | RISK-018                               |
| API-021     | SRC-014                   | AC-068                 | TEST-023, TEST-024                     | TASK-035                                                             | RISK-019                               |
| ARCH-017    | SRC-014                   | AC-062, AC-070         | TEST-024                               | TASK-032                                                             | RISK-019                               |
| ARCH-018    | SRC-014                   | AC-065, AC-069         | TEST-022, TEST-023                     | TASK-033, TASK-036                                                   | RISK-018                               |
| SEC-019     | SRC-014                   | AC-063                 | TEST-021                               | TASK-036                                                             | RISK-017                               |
| SEC-020     | SRC-014                   | AC-065, AC-069         | TEST-021, TEST-022                     | TASK-036                                                             | RISK-017, RISK-018                     |
| FR-062      | SRC-014                   | AC-062                 | TEST-024                               | TASK-032                                                             | RISK-019                               |
| FR-063      | SRC-014                   | AC-063                 | TEST-021                               | TASK-032, TASK-036                                                   | RISK-017                               |
| FR-064      | SRC-014                   | AC-064                 | TEST-022, TEST-023                     | TASK-033                                                             | RISK-017                               |
| FR-065      | SRC-014                   | AC-065                 | TEST-022                               | TASK-033                                                             | RISK-018                               |
| FR-066      | SRC-014                   | AC-066                 | TEST-023                               | TASK-034                                                             | RISK-018                               |
| FR-067      | SRC-014                   | AC-067                 | TEST-023                               | TASK-034                                                             | RISK-018                               |
| FR-068      | SRC-014                   | AC-068                 | TEST-023, TEST-024                     | TASK-035                                                             | RISK-019                               |
| FR-069      | SRC-014                   | AC-069                 | TEST-021, TEST-023                     | TASK-036                                                             | RISK-017, RISK-018                     |
| FR-070      | SRC-014                   | AC-070                 | TEST-024                               | TASK-032, TASK-036                                                   | RISK-019                               |

## Findings

### FIND-001 — scope (high)

- Claim: The accepted first release is broad rather than lean.
- Impact: Extended functions can delay the planning core and user value.
- Recommendation: Enforce phase gates; do not start Phase 5 until planning/resource/time core passes pilot criteria.
- Status: accepted mitigation in implementation phases

### FIND-002 — security (high)

- Claim: Configurable permissions and personal data make server-side authorization a release-critical control.
- Impact: A UI-only permission model could expose employee, absence, time, or location data.
- Recommendation: Implement atomic permission tests and object-scope authorization before real-data pilot.
- Status: specified; implementation evidence pending

### FIND-003 — architecture (medium)

- Claim: The canonical repository and database platform are now selected, but runtime, email, hosting, backup, and provider ADRs remain partially unresolved.
- Impact: Implementation can begin with documentation/ADR and scaffold work but production-grade coding should not assume unapproved providers or branch conventions.
- Recommendation: Use DYAI2025/Arborga only, decide master-to-main policy, adopt Supabase Frankfurt, and approve the recommended modular runtime/provider package before Phase 2.
- Status: partially_resolved_with_ADR_gate

### FIND-004 — privacy (high)

- Claim: Retention and deletion periods require legal and organizational review before production.
- Impact: Unbounded retention creates privacy and operational risk.
- Recommendation: Treat approved retention schedule as production release gate.
- Status: production blocker, not PRD blocker

### FIND-005 — scope_alignment (info)

- Claim: The supplementary MVP target does not override the approved PRD; compatible employee-lifecycle and pilot-scale precision can be added without removing broader approved scope.
- Impact: The PRD remains the single source of truth while useful supplementary detail improves testability.
- Recommendation: Keep the approved PRD scope and label supplementary values as acceptance scenarios rather than maxima.
- Status: verified_against_user_precedence_instruction

### FIND-006 — external_weather (critical)

- Claim: A once-daily forecast refresh does not satisfy the requirement to surface newly issued thunderstorms and strong-gust warnings for tree-climbing work.
- Impact: A new official warning could remain invisible during a workday if forecast and warning ingestion are treated as one daily call.
- Recommendation: Separate cached forecast/ozone calls from a centrally polled DWD CAP warning feed; poll official warnings every ten minutes and mark stale after twenty minutes. Keep the feature advisory and highly visible.
- Status: recommended_default_pending_channel_decision

### FIND-007 — privacy (high)

- Claim: Assignment-based weather does not require employee tracking.
- Impact: Implementing device-location tracking would contradict the approved non-goals and add unnecessary employee privacy risk.
- Recommendation: Store geocoded worksite coordinates and derive access from assignment visibility; do not request background or continuous employee location.
- Status: resolved_product_rule

### FIND-008 — retention (high)

- Claim: There is no single German or EU default retention duration for every Arboscus data category.
- Impact: Applying one blanket period can either over-retain sensitive employee data or delete evidence too early.
- Recommendation: Use DIN EN ISO/IEC 27555 as the deletion-method framework and approve a category matrix; treat only explicit legal periods as hard minimums.
- Status: legal_review_required_before_production

### FIND-009 — scope_and_finance (high)

- Claim: The requested economics capability is valuable but would materially expand the MVP and create confidential commercial-data and accounting-boundary risks.
- Impact: Implementing it now could delay the planning core and blur the boundary to payroll, invoicing, VAT, and bookkeeping.
- Recommendation: Keep it as a fully specified post-MVP Jira epic behind a separate phase and feature flag; implement only internal net planning/actual cost and machine-rental revenue views.
- Status: resolved_by_explicit_post_mvp_scope_gate

## Security Controls

- Risk level: **high**

### Authentication

- **SEC-101** Use invite-based accounts, secure password hashing, reset tokens, revocable sessions, and deactivation enforcement.

### Authorization

- **SEC-101** Authorization is enforced server-side and with Supabase RLS defense in depth. Weather reads require a visible assignment or an explicitly granted planner permission; no weather endpoint accepts arbitrary employee location.
- **SEC-205** Post-MVP economics endpoints and reports default to Administrator/Management only; Employee is denied even if UI routes are guessed directly.

### Secrets Management

- **SEC-103** Store application, database, email, routing, transcription, and storage secrets only in environment secret management; never in repository, client, logs, or exports.

### Logging And Redaction

- **SEC-104** Use structured audit and operational logs with correlation IDs; redact passwords, tokens, private origins, medical detail, voice content, and sensitive free text.
- **SEC-206** Confidential individual rates and amounts are not included in routine telemetry, client logs, notifications, or support traces. Audit identifies rate versions and changes with least necessary values.

### Data Protection

- **SEC-102** Use Supabase Central EU (Frankfurt), private Storage buckets, encrypted transport, minimal fields, category-based retention, independent object backups, and no continuous employee GPS. Provider data flows and DPAs are approved before production.

### Abuse Cases

- **SEC-106** Test role escalation, direct-object access, mass data export, abusive global messages, forged confirmations, unauthorized release, malicious uploads, timer manipulation, and origin leakage.

### Destructive Action Controls

- **SEC-107** Prefer deactivate/archive; require confirmations and audit for role changes, resource release, time corrections, imports, and other high-impact actions.

### Security Tests

- **TEST-101** Run automated auth/authz, session, upload, injection, rate-limit, CSRF where applicable, log-redaction, and dependency security tests before pilot and release.

### Privacy Controls

- **SEC-103** Raw audio is short-lived and local transcription is preferred; illness diagnosis is not stored; private route origin is isolated; weather uses worksite coordinates only; logs redact names, free text, coordinates where unnecessary, audio URLs, tokens, and provider keys.

### Human Review Checkpoints

- **SEC-104** Human approval is required for stack/provider ADRs, RLS matrix, retention schedule, warning communication channels, pilot targets, backup restore, real-data pilot, and production release.
- **SEC-207** Human approval is required before enabling PHASE-007, changing economics permissions, performing a backdated rate correction, or releasing economics reports/exports to another role.

## Agent Handoff

**Objective:** Implement the Arboscus Teamplaner only in DYAI2025/Arborga, starting with ADRs and preserving the approved product, authorization, privacy, weather-warning, traceability, and release rules.

### Prohibited actions

- Do not bypass API authorization or Supabase RLS.
- Do not use employee GPS/background tracking for weather.
- Do not make provider calls directly from mobile clients or once per employee.
- Do not treat forecast data as an official warning.
- Do not automatically cancel work, block publication, or issue a binding stop-work decision from weather in MVP.
- Do not expose Supabase service-role, weather, routing, email, or monitoring keys to clients.
- Do not add a provider, background job, destructive migration, or retention period without an approved ADR/policy.
- Do not log illness details, private route origins, audio, sensitive free text, precise coordinates where unnecessary, or credentials.
- Do not implement the post-MVP Planning Economics and Machine Rental capability during MVP phases.
- Do not add payroll, invoicing, VAT/gross, payment, ledger, tax, or unrelated revenue functionality.

### Stop conditions

- The repository default branch policy is unresolved for a write operation.
- The selected stack/provider conflicts with an approved ADR.
- A persistent schema change is not covered by the PRD and migration/rollback plan.
- An RLS or protected-resource rule is ambiguous.
- A production provider lacks DPA/data-region/secret ownership approval.
- A warning action beyond informative display/notification is requested.
- A legal retention period is required but not approved.

### Human review checkpoints

- After repository/stack/provider ADR package
- After RLS policy matrix and migration plan
- After weather/DWD warning prototype
- Before real employee data pilot
- After backup and independent Storage restore test
- After pilot metric review
- Before production release
- Before PHASE-007: confirm a separately approved Jira epic, feature flag, permissions, rate-version migration, and calculation source facts.
- Before any economics permission expansion beyond Administrator/Management.

## Open Questions

- **OQ-011** Approve the recommended application/runtime baseline: modular TypeScript web/PWA, server API/BFF, Supabase Frankfurt, and a separate Python worker on German hosting? (blocks PRD release: false)
- **OQ-012** Rename the current GitHub default branch from master to main before implementation, or explicitly retain master? (blocks PRD release: false)
- **OQ-013** Which transactional email system will be used: an existing Arboscus provider or the provisional Brevo recommendation? (blocks PRD release: false)
- **OQ-014** Approve forecast/ozone via OpenWeather and official warnings via DWD CAP, including forecast refresh up to every three hours and DWD warning polling every ten minutes? (blocks PRD release: false)
- **OQ-015** Should new/escalated official warnings additionally trigger browser push and email, and must employees mark them as seen? (blocks PRD release: false)
- **OQ-016** Approve the proposed pilot targets and provisional retention matrix after management and legal/data-protection review? (blocks PRD release: false)

## Final Decision

**RELEASE**
