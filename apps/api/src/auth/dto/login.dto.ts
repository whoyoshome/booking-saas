import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  // Omitted => login as SUPER_ADMIN (tenantId: null). Provided => resolves
  // the tenant by slug and scopes the user lookup to that tenant. See
  // AuthService.login for why an invalid/suspended slug returns the exact
  // same generic error as wrong credentials.
  @IsOptional()
  @IsString()
  tenantSlug?: string;
}
