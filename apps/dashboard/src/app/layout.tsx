import { isOperatorTier, parseRolesHeader } from '@vigil/security';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import { headers } from 'next/headers';

import { DevBanner } from '../components/dev-banner';
import { NavBar } from '../components/nav-bar';
import { ToastProvider } from '../components/toast';
import { UiSounds } from '../components/ui-sounds';

import type { Metadata } from 'next';

import './globals.css';

const fontSans = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
});
const fontMono = IBM_Plex_Mono({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  // Neutral default — public surfaces override per-page (FIND-011
  // closure, audit doc 10). Operator-internal surfaces inherit this
  // generic title; an operator viewing /findings sees "VIGIL APEX"
  // in their tab. Public visitors at /, /tip, /verify, /ledger see
  // the public-facing branding via their own `export const metadata`.
  title: 'VIGIL APEX',
  description: 'République du Cameroun',
  robots: 'noindex, nofollow', // operator subdomain default
};

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): JSX.Element {
  // `x-vigil-pathname` is set by middleware (apps/dashboard/src/middleware.ts).
  // Falls back to '/' so the NavBar still renders during static export or
  // non-edge runtimes that bypass middleware.
  const h = headers();
  const currentPath = h.get('x-vigil-pathname') ?? '/';
  // FIND-003 closure (audit doc 10): only render operator nav links if
  // the caller actually has an operator-class role. Unauthenticated
  // visitors and civil_society users see only the civic nav group.
  const roleSet = parseRolesHeader(h.get('x-vigil-roles'));
  const operatorView = isOperatorTier(roleSet);

  return (
    <html lang="fr" className={`${fontSans.variable} ${fontMono.variable}`}>
      <body>
        <ToastProvider>
          <DevBanner />
          <NavBar currentPath={currentPath} isOperator={operatorView} />
          <UiSounds />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
