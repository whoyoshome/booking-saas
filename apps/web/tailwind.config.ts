import type { Config } from 'tailwindcss';

// Design tokens for Booking SaaS. Chosen deliberately for a scheduling
// back-office (branch admins managing appointments for salons/clinics),
// not a marketing site — cool, calm, legible, status colors that carry
// real meaning (pine = confirmed/primary action, gold = pending/attention,
// rust = cancelled/error). Explicitly NOT the default indigo/violet SaaS
// palette, and not the warm-cream-plus-terracotta combo either — both
// read as generic/templated rather than chosen for this product.
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#17191C',
          600: '#565B61',
          400: '#8A9096',
        },
        paper: '#F3F4F0',
        surface: '#FFFFFF',
        line: '#E1E3DD',
        pine: {
          DEFAULT: '#1F6B52',
          dark: '#17543F',
          bg: '#E9F3EE',
        },
        gold: {
          DEFAULT: '#C4880F',
          dark: '#9C6C0C',
          bg: '#FBF1DC',
        },
        rust: {
          DEFAULT: '#B3432E',
          dark: '#8F3524',
          bg: '#FBEDE9',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Single, restrained elevation — not the generic soft grey shadow
        // repeated under every card regardless of hierarchy. Used only
        // for the one floating/contained surface per screen (auth form,
        // confirm summary), never for list rows.
        panel: '0 1px 2px 0 rgb(23 25 28 / 0.06), 0 8px 24px -8px rgb(23 25 28 / 0.10)',
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
    },
  },
  plugins: [],
};

export default config;
