/**
 * Transportverträge der Anmeldung (EYT-106, Slice Login→Kosten→Export).
 *
 * ## Was hier bewusst NICHT reist
 *
 * Tokens. Access- und Refresh-Token leben ausschließlich in HttpOnly-Cookies,
 * die der Server setzt und der Browser trägt — kein Schema hier enthält sie,
 * damit kein Client sie je in State, Storage oder Logs heben kann
 * (PO-Entscheidung 31.07.2026: keine Tokens in localStorage, sessionStorage
 * oder React State).
 *
 * ## Rollen und Rechte
 *
 * `role` ist die Mitgliedsrolle aus der Datenbank (`memberships.role`).
 * `permissions` sind die daraus aufgelösten atomaren Rechte — aufgelöst
 * SERVERSEITIG über `role_permissions`; der Client rechnet nie selbst von
 * Rolle auf Recht um. Eine sichtbare Navigation ersetzt keine
 * API-Autorisierung: dieselbe Rechteliste steuert nur die Anzeige.
 */
import { z } from "zod";

import { IdSchema } from "../primitives.js";

export const LoginCommandSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()).describe("Anmelde-E-Mail"),
  password: z.string().min(1).max(1024).describe("Passwort, wird nie geloggt"),
});
export type LoginCommand = z.infer<typeof LoginCommandSchema>;

/** Mitgliedsrollen — Erweiterung um `manager` kommt mit Migration 0013. */
export const MEMBERSHIP_ROLES = ["owner", "manager", "member"] as const;
export const MembershipRoleSchema = z.enum(MEMBERSHIP_ROLES);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const SessionOrganisationSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1),
  role: MembershipRoleSchema,
  /**
   * Serverseitig aufgelöste atomare Rechte (z. B. `costs.read`). Leer, bis
   * `role_permissions` existiert und der Rolle Rechte zuordnet — die UI zeigt
   * dann ehrlich keinen Kostenbereich, statt ihn aus der Rolle zu raten.
   */
  permissions: z.array(z.string().min(1)),
});
export type SessionOrganisation = z.infer<typeof SessionOrganisationSchema>;

export const SessionDtoSchema = z.strictObject({
  userId: IdSchema,
  organisations: z.array(SessionOrganisationSchema),
});
export type SessionDto = z.infer<typeof SessionDtoSchema>;
