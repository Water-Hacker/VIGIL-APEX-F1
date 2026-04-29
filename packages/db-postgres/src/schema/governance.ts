import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const governanceSchema = pgSchema('governance');

export const member = governanceSchema.table(
  'member',
  {
    id: uuid('id').primaryKey().notNull(),
    pillar: text('pillar').notNull(), // governance | judicial | civil_society | audit | technical
    display_name: text('display_name').notNull(),
    eth_address: text('eth_address').notNull(),
    yubikey_serial: text('yubikey_serial'),
    yubikey_aaguid: text('yubikey_aaguid'),
    enrolled_at: timestamp('enrolled_at', { withTimezone: true }).notNull(),
    resigned_at: timestamp('resigned_at', { withTimezone: true }),
    bio_fr: text('bio_fr').notNull(),
    bio_en: text('bio_en').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    // 0006 — WebAuthn assertion-verify (Tier 5 / DECISION-008)
    webauthn_credential_id: text('webauthn_credential_id'),
    webauthn_public_key: bytea('webauthn_public_key'),
    webauthn_counter: bigint('webauthn_counter', { mode: 'number' }).notNull().default(0),
  },
  (t) => ({
    addressUnique: unique('member_address_unique').on(t.eth_address),
    activeIdx: index('member_active_idx').on(t.is_active, t.pillar),
  }),
);

export const webauthnChallenge = governanceSchema.table(
  'webauthn_challenge',
  {
    id: uuid('id').primaryKey().notNull(),
    member_id: uuid('member_id'),
    voter_address: text('voter_address').notNull(),
    proposal_id: uuid('proposal_id').notNull(),
    challenge_b64u: text('challenge_b64u').notNull(),
    issued_at: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed_at: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => ({
    voterIdx: index('webauthn_challenge_voter_idx').on(t.voter_address, t.expires_at),
  }),
);

export const proposal = governanceSchema.table(
  'proposal',
  {
    id: uuid('id').primaryKey().notNull(),
    on_chain_index: text('on_chain_index').notNull(),
    finding_id: uuid('finding_id').notNull(),
    dossier_id: uuid('dossier_id'),
    state: text('state').notNull().default('open'),
    opened_at: timestamp('opened_at', { withTimezone: true }).notNull(),
    closes_at: timestamp('closes_at', { withTimezone: true }).notNull(),
    closed_at: timestamp('closed_at', { withTimezone: true }),
    yes_votes: integer('yes_votes').notNull().default(0),
    no_votes: integer('no_votes').notNull().default(0),
    abstain_votes: integer('abstain_votes').notNull().default(0),
    recuse_votes: integer('recuse_votes').notNull().default(0),
    proposal_tx_hash: text('proposal_tx_hash'),
    closing_tx_hash: text('closing_tx_hash'),
  },
  (t) => ({ chainUnique: unique('proposal_chain_unique').on(t.on_chain_index) }),
);

export const vote = governanceSchema.table(
  'vote',
  {
    id: uuid('id').primaryKey().notNull(),
    proposal_id: uuid('proposal_id').notNull(),
    voter_address: text('voter_address').notNull(),
    voter_pillar: text('voter_pillar').notNull(),
    choice: text('choice').notNull(), // YES | NO | ABSTAIN | RECUSE
    cast_at: timestamp('cast_at', { withTimezone: true }).notNull(),
    vote_tx_hash: text('vote_tx_hash').notNull(),
    recuse_reason: text('recuse_reason'),
  },
  (t) => ({ uniqueVote: unique('vote_unique_per_proposal').on(t.proposal_id, t.voter_address) }),
);
