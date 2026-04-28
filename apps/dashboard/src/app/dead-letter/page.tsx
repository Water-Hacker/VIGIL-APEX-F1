import { getLocale, loadMessages, t } from '../../lib/i18n.js';
import { listDeadLetter } from '../../lib/dead-letter.server.js';

import { DeadLetterTable } from './table.js';

export const dynamic = 'force-dynamic';

export default async function DeadLetterPage(): Promise<JSX.Element> {
  const locale = getLocale();
  const messages = await loadMessages(locale);
  const rows = await listDeadLetter({ resolved: false, limit: 200 });

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t(messages, 'dead_letter.title')}</h1>
        <p className="text-sm text-gray-500">{rows.length} unresolved</p>
      </header>

      {rows.length === 0 ? (
        <p>{t(messages, 'dead_letter.empty')}</p>
      ) : (
        <DeadLetterTable
          rows={rows}
          labels={{
            retryOne: t(messages, 'dead_letter.retry_one'),
            retryBulk: t(messages, 'dead_letter.retry_bulk'),
            resolve: t(messages, 'dead_letter.resolve'),
          }}
        />
      )}
    </main>
  );
}
