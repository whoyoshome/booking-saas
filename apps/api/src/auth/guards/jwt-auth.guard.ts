import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Protects an endpoint by requiring a valid access token in the
 * Authorization: Bearer <token> header. Applied explicitly per controller/
 * handler (not as a global guard) — we prefer routes "explicitly protected
 * by default" over a global guard with a @Public() exception list, which
 * is easier to misuse by omission.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
