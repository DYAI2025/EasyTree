/**
 * Anmelde-Endpunkte (EYT-106): /auth/login, /auth/logout, /auth/session.
 *
 * Tokens verlassen diesen Controller ausschliesslich als HttpOnly-Cookies.
 * Kein Endpunkt gibt je ein Token im Koerper zurueck, keine Meldung enthaelt
 * Tokenmaterial oder Passwoerter.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseFilters,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { LoginCommandSchema, type SessionDto } from "@easytree/contracts";
import type { AppConfig } from "@easytree/config";

import { APP_CONFIG } from "../../../../config/config.module";
import {
  RequestIdentityService,
  REQUEST_IDENTITY,
} from "../../../../platform/auth/request-identity";
import {
  clearSessionCookies,
  serializeAccessCookie,
  serializeRefreshCookie,
  ACCESS_COOKIE,
  readCookie,
  type CookieEnvironment,
} from "../../../../platform/auth/session-cookies";
import { TOKEN_VERIFIER, type TokenVerifier } from "../../../../platform/auth/token-verifier";
import { PASSWORD_LOGIN, type PasswordLoginPort } from "../../application/password-login.port";
import {
  SESSION_ORGANISATIONS,
  type SessionOrganisationsPort,
} from "../../application/session-organisations.port";
import { AUTH_ERROR_TYPE, AuthProblemFilter } from "./auth-problem.filter";

@Controller("auth")
@UseFilters(AuthProblemFilter)
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PASSWORD_LOGIN) private readonly passwordLogin: PasswordLoginPort,
    @Inject(SESSION_ORGANISATIONS) private readonly organisations: SessionOrganisationsPort,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(REQUEST_IDENTITY) private readonly requestIdentity: RequestIdentityService,
  ) {}

  private cookieEnvironment(): CookieEnvironment {
    return { secure: this.config.nodeEnv === "production" };
  }

  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const parsed = LoginCommandSchema.safeParse(body);
    if (!parsed.success) {
      // Feldnamen ja, Werte nie — dieselbe Redaktionsregel wie ueberall.
      throw new BadRequestException(
        `Ungültige Anmeldedaten-Form: ${parsed.error.issues
          .map((issue) => issue.path.join(".") || "körper")
          .join(", ")}`,
      );
    }

    const grant = await this.passwordLogin.grant(parsed.data.email, parsed.data.password);
    if (!grant.ok) {
      if (grant.reason === "AUTH_SERVER_UNAVAILABLE") {
        throw new ServiceUnavailableException({
          type: AUTH_ERROR_TYPE.AUTH_SERVER_UNAVAILABLE,
          message: "Der Anmeldedienst ist nicht erreichbar. Bitte später erneut versuchen.",
        });
      }
      // Bewusst EINE Meldung fuer unbekannte E-Mail und falsches Passwort.
      throw new UnauthorizedException({
        type: AUTH_ERROR_TYPE.UNAUTHENTICATED,
        message: "E-Mail oder Passwort ist falsch.",
      });
    }

    // Das frisch ausgestellte Token durch DIESELBE Pruefkette wie jede
    // Anfrage — ein Auth-Server, der etwas anderes ausstellt als erwartet,
    // faellt hier auf und nicht erst beim ersten Datenzugriff.
    const identitaet = await this.verifier.verify(grant.accessToken);
    const orgs = await this.organisations.organisationsFor(identitaet.userId);

    const env = this.cookieEnvironment();
    res.setHeader("Set-Cookie", [
      serializeAccessCookie(grant.accessToken, grant.expiresInSeconds, env),
      serializeRefreshCookie(grant.refreshToken, env),
    ]);

    return toSessionDto(identitaet.userId, orgs);
  }

  @Get("session")
  async session(@Req() req: Request): Promise<SessionDto> {
    const identitaet = await this.requestIdentity.identify({
      cookieHeader: req.headers.cookie,
      authorizationHeader: req.headers.authorization,
    });
    const orgs = await this.organisations.organisationsFor(identitaet.userId);
    return toSessionDto(identitaet.userId, orgs);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const accessToken = readCookie(req.headers.cookie, ACCESS_COOKIE);
    if (accessToken !== null) {
      // Best effort — Fehler hier verhindern das Abmelden nicht.
      await this.passwordLogin.revoke(accessToken);
    }
    res.setHeader("Set-Cookie", [...clearSessionCookies(this.cookieEnvironment())]);
  }
}

function toSessionDto(
  userId: string,
  orgs: readonly {
    organisationId: string;
    organisationName: string;
    role: "owner" | "manager" | "member";
    permissions: readonly string[];
  }[],
): SessionDto {
  return {
    userId,
    organisations: orgs.map((org) => ({
      id: org.organisationId,
      name: org.organisationName,
      role: org.role,
      permissions: [...org.permissions],
    })),
  };
}
