'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
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

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

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
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded border p-6">
        <h1 className="text-xl font-semibold">Booking SaaS</h1>

        <div className="space-y-1">
          <label htmlFor="tenantOption" className="block text-sm font-medium">
            Tenant
          </label>
          <select
            id="tenantOption"
            value={tenantOption}
            onChange={(e) => setTenantOption(e.target.value)}
            className="w-full rounded border px-3 py-2"
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
            <label htmlFor="customSlug" className="block text-sm font-medium">
              Tenant slug
            </label>
            <input
              id="customSlug"
              type="text"
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value)}
              placeholder="mi-tenant"
              className="w-full rounded border px-3 py-2"
            />
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-black py-2 text-white disabled:opacity-50"
        >
          {submitting ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}
