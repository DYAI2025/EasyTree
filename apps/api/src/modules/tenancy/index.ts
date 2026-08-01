/**
 * Tenancy-Modul (EYT-106): Identitaet, Mitgliedschaft, Anmeldung.
 *
 * Nur benannte Exporte — dieselbe Regel wie in jedem Modul. Die Verdrahtung
 * geschieht im AppModule; dieses Modul stellt Ports, Adapter und den
 * Auth-Controller bereit.
 */
export { MEMBERSHIP_ROLES, isMembershipRole } from "./domain/membership";
export type { MembershipRole, OrganisationMembership } from "./domain/membership";

export { PASSWORD_LOGIN, LOGIN_REJECTIONS } from "./application/password-login.port";
export type {
  LoginGrant,
  LoginRejected,
  LoginRejection,
  LoginResult,
  PasswordLoginPort,
} from "./application/password-login.port";
export { SESSION_ORGANISATIONS } from "./application/session-organisations.port";
export type { SessionOrganisationsPort } from "./application/session-organisations.port";

export { GotruePasswordLogin } from "./infrastructure/gotrue-password-login";
export type { GotruePasswordLoginInput } from "./infrastructure/gotrue-password-login";
export { MembershipRepository } from "./infrastructure/membership-repository";

export { AuthController } from "./interface/http/auth.controller";
export { AuthProblemFilter, AUTH_ERROR_TYPE } from "./interface/http/auth-problem.filter";
