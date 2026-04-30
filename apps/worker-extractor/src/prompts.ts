/**
 * Registers the `procurement.extract-fields` prompt with the global
 * SafeLlmRouter prompt registry. AI-SAFETY-DOCTRINE-v1 §B.12 — every
 * Claude call must reference a registered (name, version, hash) tuple.
 *
 * Side-effect import: `import './prompts.js'` from llm-extractor.ts
 * triggers registration on module load.
 */

import { Safety } from '@vigil/llm';

const { globalPromptRegistry } = Safety;

const NEUTRAL_FRAMING_HEADER =
  'You are a research assistant for an anti-corruption platform. You extract structured fields from raw procurement listings. You do NOT speculate about fraud — your only job is to surface what the text literally says.';

interface ProcurementExtractInput {
  readonly task: string;
}

globalPromptRegistry.register({
  name: 'procurement.extract-fields',
  version: 'v1.0.0',
  description:
    'Extract structured procurement fields (bidder_count, procurement_method, supplier_name, amount_xaf, dates) from raw ARMP/MINMAP/COLEPS listing text. Verbatim quote required for every claim; llm_confidence in [0,1]. Output validated by zLlmExtractionResponse.',
  render: (input) => {
    const i = input as ProcurementExtractInput;
    return {
      system:
        NEUTRAL_FRAMING_HEADER +
        '\n\nThe listing is in French. Cameroonian procurement vocabulary applies — "gré à gré" = sole-source, "appel d\'offres ouvert" = open tender. Currency is FCFA / XAF. RCCM = registre du commerce. NIU = numéro d\'identifiant unique fiscal.',
      user:
        i.task ??
        'Return {"status":"ok","items":[...]} where each item has field, value, verbatim_quote, llm_confidence. If the listing has no usable evidence, return {"status":"insufficient_evidence","items":[]}.',
    };
  },
});
