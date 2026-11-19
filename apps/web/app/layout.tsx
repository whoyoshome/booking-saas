import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AuthProvider } from '../lib/auth-context';

// Two families, clearly distinct roles: Space Grotesk (geometric, a bit
// unusual, good numerals — carries the "time/schedule" personality on
// headings and the wordmark) and IBM Plex Sans (built for dense UI text —
// forms, list rows, status chips) for everything else. Deliberately not
// Inter/system-ui, which is the default reach for almost every generated
// interface and carries no point of view of its own.
//
// Self-hosted so `next build` needs no network (next/font/google failed
// intermittently in CI while downloading). The files in ./fonts are the
// exact latin-subset variable fonts next/font/google used to serve (the
// only subset the UI ever loaded); each family's OFL license sits beside
// it. Same weights, CSS variables and swap behavior as before.
const displayFont = localFont({
  src: './fonts/space-grotesk-latin-wght.woff2',
  weight: '500 700',
  variable: '--font-display',
  display: 'swap',
});

const bodyFont = localFont({
  src: './fonts/ibm-plex-sans-latin-wght.woff2',
  weight: '400 600',
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Booking SaaS',
  description: 'Plataforma de reservas multi-tenant para negocios de servicios.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
