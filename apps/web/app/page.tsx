import { redirect } from 'next/navigation';

// middleware.ts already redirects every request to "/" before this page's
// body ever runs (based on the bk_session cookie — see middleware.ts for
// what that cookie does and does not guarantee). This is a real Server
// Component, kept only as a defensive fallback in case the middleware
// matcher config ever changes and a request reaches this route directly —
// cheap insurance, not the primary routing mechanism.
export default function Home() {
  redirect('/login');
}
