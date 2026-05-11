import { headers } from 'next/headers';

import { actorFromHeaders, emitFromServerComponent } from '../../lib/audit-emit.server';
import { getLocale, loadMessages, t } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

/**
 * Forbidden-access page rendered when middleware rewrites a non-authorised
 * request. Closes FIND-001 (whole-system-audit doc 10): every rewrite to
 * /403 now emits a structured `permission.denied` TAL-PA audit event with
 * the requesting actor, the originally-requested path, the role set the
 * caller presented, and the roles that WOULD have been sufficient. If the
 * audit emit fails the page throws — TAL-PA "no dark periods" applies.
 */
export default async function ForbiddenPage(): Promise<JSX.Element> {
  const h = headers();
  const locale = getLocale();
  const messages = await loadMessages(locale);

  const actor = actorFromHeaders(h as unknown as Headers);
  const forbiddenPath = h.get('x-vigil-forbidden-path') ?? '/';
  const requiredRoles = h.get('x-vigil-forbidden-required-roles') ?? '';
  const userAgent = h.get('user-agent') ?? null;
  const requestId = h.get('x-request-id') ?? null;

  await emitFromServerComponent({
    eventType: 'permission.denied',
    actor,
    targetResource: forbiddenPath,
    actionPayload: {
      attempted_path: forbiddenPath,
      required_roles: requiredRoles ? requiredRoles.split(',') : [],
      presented_roles: actor.actor_role === 'public' ? [] : [actor.actor_role],
      user_agent: userAgent,
      request_id: requestId,
      verdict: 'forbidden',
    },
    resultStatus: 'denied',
    correlationId: requestId,
  });

  return (
    <main className="mx-auto max-w-md p-6 space-y-2" role="alert">
      <h1 className="text-2xl font-semibold">{t(messages, 'auth.forbidden_title')}</h1>
      <p className="text-sm text-gray-700">{t(messages, 'auth.forbidden_body')}</p>
    </main>
  );
}
