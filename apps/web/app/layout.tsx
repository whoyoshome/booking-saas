import type { Metadata } from 'next';
import { Space_Grotesk, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '../lib/auth-context';

// Two families, clearly distinct roles: Space Grotesk (geometric, a bit
// unusual, good numerals — carries the "time/schedule" personality on
// headings and the wordmark) and IBM Plex Sans (built for dense UI text —
// forms, list rows, status chips) for everything else. Deliberately not
// Inter/system-ui, which is the default reach for almost every generated
// interface and carries no point of view of its own.
const displayFont = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const bodyFont = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
