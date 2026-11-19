import '@testing-library/jest-dom/vitest';
import { createElement, type ReactNode } from 'react';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Vitest runs without globals here, so Testing Library's automatic cleanup
// is not registered; do it explicitly.
afterEach(() => {
  cleanup();
});

// next/link needs no router to render an anchor, but mocking it keeps the
// tests independent of Next's internals and drops its `replace` prop.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    replace,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    replace?: boolean;
    [key: string]: unknown;
  }) => {
    void replace;
    return createElement('a', { href, ...rest }, children);
  },
}));
