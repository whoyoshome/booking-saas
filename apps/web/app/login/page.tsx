'use client';

import { useState, type FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';

const CUSTOM_OPTION = '__custom__';

// P2 — known demo tenants as a select, instead of a raw text input asking
// a recruiter to type a slug they have no way of knowing. "Otro" keeps
// the raw-text path available (not removed, just no longer the default),
// since a real multi-tenant product will always have more tenants than
// two hardcoded ones.
const DEMO_OPTIONS = [
  { value: '', label: 'Super admin (sin tenant)' },
  { value: 'tenant-a', label: 'Tenant A — Demo Clínica' },
  { value: 'tenant-b', label: 'Tenant B — Demo Salón' },
  { value: CUSTOM_OPTION, label: 'Otro (escribir slug manualmente)' },
];

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-600">
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded border border-line bg-surface px-3 py-2 text-ink placeholder:text-ink-400 focus-visible:border-pine';

function postLoginPath(from: string | null): string {
  if (from && (from.startsWith('/dashboard') || from.startsWith('/book'))) {
    return from;
  }
  return '/dashboard';
}

function LoginPageContent() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantOption, setTenantOption] = useState('tenant-a');
  const [customSlug, setCustomSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = tenantOption === CUSTOM_OPTION ? customSlug : tenantOption;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, effectiveSlug || undefined);
      router.push(postLoginPath(searchParams.get('from')));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded border border-line bg-surface p-8 shadow-panel"
      >
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">
            Booking<span className="text-pine">SaaS</span>
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            El cliente pide el turno. El admin o el staff lo aceptan o lo rechazan.
          </p>
        </div>

        <div className="space-y-1">
          <FieldLabel htmlFor="tenantOption">Tenant</FieldLabel>
          <select
            id="tenantOption"
            value={tenantOption}
            onChange={(e) => setTenantOption(e.target.value)}
            className={inputClass}
          >
            {DEMO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {tenantOption === CUSTOM_OPTION && (
          <div className="space-y-1">
            <FieldLabel htmlFor="customSlug">Tenant slug</FieldLabel>
            <input
              id="customSlug"
              type="text"
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value)}
              placeholder="mi-tenant"
              className={inputClass}
            />
          </div>
        )}

        <div className="space-y-1">
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          {tenantOption !== CUSTOM_OPTION && tenantOption !== '' && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEmail('cliente@tenant.dev')}
                className="text-xs font-medium text-pine underline underline-offset-2"
              >
                Cuenta cliente
              </button>
              <button
                type="button"
                onClick={() => setEmail('admin@tenant.dev')}
                className="text-xs font-medium text-pine underline underline-offset-2"
              >
                Cuenta admin
              </button>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && (
          <p className="rounded bg-rust-bg px-3 py-2 text-sm text-rust-dark">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-pine py-2.5 font-medium text-white transition-colors hover:bg-pine-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="p-8 text-sm text-ink-600">Cargando…</main>}>
      <LoginPageContent />
    </Suspense>
  );
}
