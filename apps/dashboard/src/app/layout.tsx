import { Inter, IBM_Plex_Mono } from 'next/font/google';
import { headers } from 'next/headers';

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
  title: 'VIGIL APEX',
  description: 'Real-Time Public Finance Compliance, Governance Monitoring & Intelligence Platform',
  robots: 'noindex, nofollow', // operator surface; verify subdomain overrides
};

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): JSX.Element {
  // `x-vigil-pathname` is set by middleware (apps/dashboard/src/middleware.ts).
  // Falls back to '/' so the NavBar still renders during static export or
  // non-edge runtimes that bypass middleware.
  const currentPath = headers().get('x-vigil-pathname') ?? '/';

  return (
    <html lang="fr" className={`${fontSans.variable} ${fontMono.variable}`}>
      <body>
        <ToastProvider>
          <NavBar currentPath={currentPath} />
          <UiSounds />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
