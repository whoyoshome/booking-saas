'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Fase 7: replaces the Fase 1 Docker-networking health-check demo (moved
// its purpose — confirming web <-> api connectivity — to the dashboard's
// live GET /branches call, which now does that AND is actually useful).
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, [router]);

  return null;
}
