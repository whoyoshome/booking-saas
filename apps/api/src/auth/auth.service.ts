import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './types/jwt-payload.type';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * DESIGN: single active session per user.
 *
 * We store a single `refreshTokenHash` on the user row, not a `refresh_tokens`
 * table with multiple sessions per device. Explicit consequence: if the user
 * logs in from a second device, the first is invalidated on its next refresh.
 *
 * This is a deliberate MVP simplification, not an oversight — modeling
 * multi-session (separate table, one hash per device/session, individual
 * revocation) is the natural evolution when that becomes a real product
 * requirement ("I want to be logged in on my phone and laptop at the same
 * time"). Adding it now without that requirement would be exactly the kind
 * of over-engineering we want to avoid.
 *
 * DESIGN — RLS bypass, Step 5: `users` now has FORCE ROW LEVEL SECURITY
 * enabled. AuthService is the one place in the codebase allowed to bypass
 * it unconditionally, via withSystemContext() below. This is not a
 * loophole: by definition, resolving *who* the caller is (which user,
 * which tenant, if any) has to happen before any tenant context exists to
 * scope a query by — the same reasoning that put `app.is_super_admin` in
 * the design from Step 4. Every other repository, once RLS-protected
 * tables outside `users` exist, must go through PrismaService.client
 * (Step 4) instead, never this bypass.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Runs `fn` inside a transaction with app.is_super_admin = true set for
   * its duration, so queries against `users` (FORCE RLS-protected as of
   * Step 5) are not blocked. Used exclusively by AuthService — see the
   * class-level DESIGN note above for why this bypass exists here and
   * nowhere else.
   */
  private async withSystemContext<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
      return fn(tx);
    });
  }

  async login(
    email: string,
    password: string,
    tenantSlug?: string,
  ): Promise<TokenPair> {
    // Identical message in every failure branch below — wrong password,
    // unknown email, unknown tenantSlug, or a suspended tenant all return
    // this exact same error. Distinguishing any of these cases is an
    // information leak: it would let someone enumerate valid tenant slugs
    // or registered emails one probe at a time.
    const invalidCredentialsError = new UnauthorizedException(
      'Credenciales inválidas.',
    );

    let tenantId: string | null = null;

    if (tenantSlug) {
      // Tenants table has no RLS (it's not itself scoped to a tenant), so
      // this lookup does not need the system-context bypass.
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: tenantSlug },
      });

      if (!tenant || tenant.status !== 'ACTIVE') {
        // Same dummy-hash timing mitigation as the "user not found" branch
        // below — a suspended/nonexistent tenant should take the same
        // amount of time to reject as a wrong password would.
        await argon2.hash('dummy-password-for-timing');
        throw invalidCredentialsError;
      }

      tenantId = tenant.id;
    }

    // FIX — Prisma's generated TS input type for a compound @unique field
    // does not accept an explicit `null` for a nullable component
    // (tenant_email_unique: { tenantId, email }), even though the
    // underlying SQL handles NULL correctly. findUnique on that compound
    // key fails to compile (TS2322) when tenantId is null. Split into two
    // branches instead of fighting the generated types:
    //   - tenantSlug omitted (SUPER_ADMIN): findFirst on { tenantId: null, email }.
    //   - tenantSlug provided: findUnique on the real compound key — this
    //     path stays a single indexed lookup, no scan.
    const user = await this.withSystemContext((tx) =>
      tenantId
        ? tx.user.findUnique({
            where: { tenant_email_unique: { tenantId, email } },
          })
        : tx.user.findFirst({
            where: { tenantId: null, email },
          }),
    );

    if (!user) {
      // Run a dummy hash anyway so response time does not reveal whether the
      // email exists (basic timing attack mitigation).
      await argon2.hash('dummy-password-for-timing');
      throw invalidCredentialsError;
    }

    const passwordMatches = await argon2.verify(user.passwordHash, password);
    if (!passwordMatches) {
      throw invalidCredentialsError;
    }

    return this.issueTokenPair(user.id, user.role, user.tenantId);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const invalidTokenError = new UnauthorizedException(
      'Refresh token inválido o expirado.',
    );

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw invalidTokenError;
    }

    const user = await this.withSystemContext((tx) =>
      tx.user.findUnique({ where: { id: payload.sub } }),
    );

    if (!user || !user.refreshTokenHash) {
      throw invalidTokenError;
    }

    // Compare against the stored HASH, never against the plaintext token.
    // If the database is leaked, an attacker does not get directly usable
    // tokens.
    const matchesStored = await argon2.verify(
      user.refreshTokenHash,
      refreshToken,
    );
    if (!matchesStored) {
      // Signal of possible theft/reuse of an already-rotated refresh token.
      // Revoke the entire session as a defensive measure.
      await this.withSystemContext((tx) =>
        tx.user.update({
          where: { id: user.id },
          data: { refreshTokenHash: null },
        }),
      );
      this.logger.warn(
        `Refresh token reuse detected for user ${user.id} — session revoked.`,
      );
      throw invalidTokenError;
    }

    // Rotation: the used refresh token is immediately invalidated and a new
    // one is issued. This limits the window of use for a stolen token to a
    // single refresh operation.
    return this.issueTokenPair(user.id, user.role, user.tenantId);
  }

  async logout(userId: string): Promise<void> {
    await this.withSystemContext((tx) =>
      tx.user.update({
        where: { id: userId },
        data: { refreshTokenHash: null },
      }),
    );
  }

  private async issueTokenPair(
    userId: string,
    role: JwtPayload['role'],
    tenantId: string | null,
  ): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, role, tenantId };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    });

    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    const refreshTokenHash = await argon2.hash(refreshToken, {
      type: argon2.argon2id,
    });

    await this.withSystemContext((tx) =>
      tx.user.update({
        where: { id: userId },
        data: { refreshTokenHash },
      }),
    );

    return { accessToken, refreshToken };
  }
}
