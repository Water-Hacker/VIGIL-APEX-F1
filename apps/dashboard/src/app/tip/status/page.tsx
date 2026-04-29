import { getLocale, loadMessages, t } from '../../../lib/i18n';

import { StatusLookup } from './lookup';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { ref?: string };
}

export default async function TipStatusPage({ searchParams }: PageProps): Promise<JSX.Element> {
  const locale = getLocale();
  const messages = await loadMessages(locale);
  const ref = typeof searchParams.ref === 'string' ? searchParams.ref : '';

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-semibold">
        {t(messages, 'tip.status.title', { ref: ref || '—' })}
      </h1>
      <StatusLookup
        initialRef={ref}
        labels={{
          dispositionLabel: t(messages, 'tip.status.disposition'),
          receivedOnLabel: t(messages, 'tip.status.received_on', { date: '{date}' }),
          notFound: t(messages, 'errors.404.title'),
          submit: t(messages, 'common.submit'),
        }}
      />
    </main>
  );
}
