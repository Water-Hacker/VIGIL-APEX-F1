import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'VIGIL APEX',
  description: 'Real-Time Public Finance Compliance, Governance Monitoring & Intelligence Platform',
  robots: 'noindex, nofollow', // operator surface; verify subdomain overrides
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
