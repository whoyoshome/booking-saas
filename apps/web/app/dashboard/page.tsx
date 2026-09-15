'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { apiFetch } from '../../lib/api-client';

interface Branch {
  id: string;
  name: string;
  timezone: string;
}

export default function DashboardPage() {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;

    apiFetch('/branches')
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /branches -> ${res.status}`);
        setBranches(await res.json());
      })
      .catch((err: Error) => setError(err.message));
  }, [isAuthenticated]);

  // Renders nothing meaningful until the client-side auth check resolves
  // and, if unauthenticated, the redirect above fires — avoids a flash of
  // protected content before the redirect takes effect.
  if (isLoading || !isAuthenticated) {
    return <main className="p-8">Cargando...</main>;
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-4">
          <a href="/book" className="text-sm font-medium underline">
            Nueva reserva
          </a>
          <button onClick={logout} className="text-sm text-gray-500 underline">
            Cerrar sesión
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-red-600">
          Error consultando la API: {error}
        </p>
      )}

      {branches === null && !error && <p>Cargando sucursales...</p>}

      {branches !== null && (
        <>
          <h2 className="mb-2 text-sm font-medium text-gray-500">
            Sucursales ({branches.length})
          </h2>
          <ul className="space-y-2">
            {branches.map((b) => (
              <li key={b.id} className="rounded border p-3">
                <p className="font-medium">{b.name}</p>
                <p className="text-sm text-gray-500">{b.timezone}</p>
              </li>
            ))}
          </ul>
          {branches.length === 0 && (
            <p className="text-sm text-gray-500">
              Sin sucursales todavía para este tenant.
            </p>
          )}
        </>
      )}
    </main>
  );
}
