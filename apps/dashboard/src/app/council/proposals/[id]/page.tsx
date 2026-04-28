import { GovernanceRepo, getDb } from '@vigil/db-postgres';
import { notFound } from 'next/navigation';

import { getLocale, loadMessages, t } from '../../../../lib/i18n.js';

import { VoteCeremony } from './vote-ceremony.js';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function ProposalDetailPage({ params }: PageProps): Promise<JSX.Element> {
  const db = await getDb();
  const repo = new GovernanceRepo(db);
  const proposal = await repo.getProposalById(params.id);
  if (!proposal) notFound();

  const locale = getLocale();
  const messages = await loadMessages(locale);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {t(messages, 'council.proposals.title')} #{proposal.on_chain_index}
        </h1>
        <p className="text-sm text-gray-500">
          finding {proposal.finding_id} ·{' '}
          opened {new Date(proposal.opened_at).toLocaleString(locale)} ·{' '}
          closes {new Date(proposal.closes_at).toLocaleString(locale)}
        </p>
      </header>

      <section
        aria-labelledby="tally"
        className="grid grid-cols-4 gap-4 border rounded p-4 tabular-nums"
      >
        <h2 id="tally" className="sr-only">
          Tally
        </h2>
        <div>
          <div className="text-xs uppercase text-gray-500">{t(messages, 'council.vote.yes')}</div>
          <div className="text-2xl font-semibold text-emerald-700">{proposal.yes_votes}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">{t(messages, 'council.vote.no')}</div>
          <div className="text-2xl font-semibold text-red-700">{proposal.no_votes}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">{t(messages, 'council.vote.abstain')}</div>
          <div className="text-2xl font-semibold text-gray-700">{proposal.abstain_votes}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">{t(messages, 'council.vote.recuse')}</div>
          <div className="text-2xl font-semibold text-gray-700">{proposal.recuse_votes}</div>
        </div>
      </section>

      <VoteCeremony
        proposalId={proposal.id}
        labels={{
          yes: t(messages, 'council.vote.yes'),
          no: t(messages, 'council.vote.no'),
          abstain: t(messages, 'council.vote.abstain'),
          recuse: t(messages, 'council.vote.recuse'),
          touchYubikey: t(messages, 'council.vote.touch_yubikey'),
          broadcasting: t(messages, 'council.vote.broadcasting'),
          duplicate: t(messages, 'council.vote.duplicate'),
          success: t(messages, 'council.vote.success', { tx: '{tx}' }),
          submit: t(messages, 'common.submit'),
          cancel: t(messages, 'common.cancel'),
        }}
      />
    </main>
  );
}
