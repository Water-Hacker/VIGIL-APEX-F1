import { getLocale, loadMessages, t } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

export default async function ForbiddenPage(): Promise<JSX.Element> {
  const locale = getLocale();
  const messages = await loadMessages(locale);
  return (
    <main className="mx-auto max-w-md p-6 space-y-2" role="alert">
      <h1 className="text-2xl font-semibold">{t(messages, 'auth.forbidden_title')}</h1>
      <p className="text-sm text-gray-700">{t(messages, 'auth.forbidden_body')}</p>
    </main>
  );
}
