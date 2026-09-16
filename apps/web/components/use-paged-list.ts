'use client';

import { useMemo, useState } from 'react';

const PAGE_SIZE = 8;

/**
 * Caps long dashboard/book lists so 30+ rows don't become one infinite
 * scroll. Search is client-side (the API already returned the tenant's
 * full list); "Ver más" reveals the next page.
 */
export function usePagedList<T>(items: T[], filter: (item: T, q: string) => boolean) {
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => filter(item, q));
  }, [items, query, filter]);

  const shown = filtered.slice(0, visible);
  const remaining = Math.max(0, filtered.length - shown.length);

  function onQueryChange(value: string) {
    setQuery(value);
    setVisible(PAGE_SIZE);
  }

  return {
    query,
    onQueryChange,
    shown,
    remaining,
    total: filtered.length,
    showMore: () => setVisible((n) => n + PAGE_SIZE),
  };
}
