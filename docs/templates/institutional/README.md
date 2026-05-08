# Institutional letter templates (F3.1, F4)

> **Drafting authorisation:** CLAUDE.md — "Drafting (not finalising)
> candidate conversations, letters, and agreements per EXEC §11,
> §15, §19 templates." Each letter in this directory MUST be
> reviewed by a Cameroonian lawyer admitted to the bar before it is
> sent or filed (EXEC §27 disclaimer: templates are starting points,
> not legal counsel).

## Files

| File                                                                               | Purpose                                                                                                    | Tracker entry |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------- |
| [F3.1-conac-engagement-letter.md](F3.1-conac-engagement-letter.md)                 | First letter to CONAC requesting a transmission channel for technical dossiers (FR + EN record). EXEC §15. | F3.1          |
| [F4-antic-data-processing-declaration.md](F4-antic-data-processing-declaration.md) | Declaration to ANTIC for the platform's personal-data processing (FR — filed; EN record only). W-23.       | F4            |

## Workflow per letter

1. **Build agent drafts** the template, parameterising every
   variable in `{{ ... }}`.
2. **Architect adapts** the template to the current addressee
   (verify B.P., recipient title, recent regulatory references).
3. **Cameroonian lawyer reviews** the adapted draft. The lawyer
   adapts to the most recent ANTIC form / CONAC convention / decree
   reference.
4. **Architect signs** the lawyer-reviewed version on physical
   paper.
5. **Letter is sent / filed** through the institution's preferred
   channel (registered mail, in-person delivery against signature,
   or — for ANTIC — the official electronic portal if it exists at
   the time).
6. **Acknowledgement / receipt** is recorded in the audit chain
   (TAL-PA event `decision.recorded` with the institution name +
   reference number when CONAC issues one per F3.1).

## What this directory does NOT contain

- The architect's actual signed copy. Signed copies live in the
  architect's personal records and are NOT committed to the repo
  (they contain a real signature; signature images are
  privacy-sensitive).
- Lawyer-side drafts. Once the lawyer adapts a template, that
  adapted version is between architect and lawyer; the repo retains
  only the build-agent template for institutional knowledge
  transfer.
- Specific names. Recipient titles only ("Monsieur le Président",
  "Monsieur le Directeur Général"); placeholders for the architect's
  own contact details.
- Compensation or partnership terms. CONAC engagement asks for the
  minimum (acknowledgement + reference number); ANTIC declaration
  is a regulatory filing, not a commercial agreement.

## What was deliberately NOT drafted (yet)

- **First reminder letter** if CONAC is silent past 90 days
  (EXEC §15.5). Drafted only when needed, to avoid pre-committing
  to a tone the architect may want to choose differently after
  observing CONAC's silence.
- **Plan B letter to Cour des Comptes** (DECISION-010 routing). Same
  reason — the architect's tone in escalating to Plan B depends on
  the CONAC interaction's actual character.
- **Council commitment letter** (EXEC §12). Separate template; the
  council-first-contact templates at [docs/templates/council/](../council/)
  cover the §11 first conversation only. The §12 commitment letter is
  the second-conversation close.
