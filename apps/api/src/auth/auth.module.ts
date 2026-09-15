import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    // JwtModule is registered without a global secret/expiresIn config on
    // purpose: AuthService signs access and refresh tokens with TWO distinct
    // secrets (JWT_SECRET vs JWT_REFRESH_SECRET), so configuration is passed
    // explicitly in each signAsync/verifyAsync instead of relying on a global
    // default that only works for one of the two cases.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
