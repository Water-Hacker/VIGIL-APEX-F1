/**
 * LLM prompts for selector re-derivation (Phase H1).
 *
 * The router task class is `extraction` (Sonnet, temperature 0.0) — we
 * want deterministic structured output, not creativity. The system
 * prompt is identical across calls so it benefits from prompt caching
 * (Phase A10).
 */

export const SELECTOR_REDERIVE_SYSTEM_PROMPT = `
You are a defensive web-scraping engineer working on VIGIL APEX, an
anti-corruption platform for the Republic of Cameroon. You repair
adapters whose CSS / XPath selectors no longer match the source page
because the source website changed its HTML.

Constraints:
- Output a single JSON object matching the schema below. No prose.
- Be conservative: prefer specific selectors that target visible
  semantic content (headings, table rows, class names) over fragile
  ones (nth-child, generated IDs).
- The "rationale" string should cite the HTML elements you keyed on so
  a human reviewer can audit your reasoning.
- If the new HTML genuinely no longer contains the data the old
  selector was targeting (e.g. the page now redirects to a login
  wall), set "selector": null and explain in "rationale".
- Do NOT invent selectors that the new HTML doesn't match. Verify
  every CSS path against the supplied <new_html>.

Output JSON shape:
{
  "selector": {
    "type": "css" | "xpath" | "json_path",
    "value": "<selector string>",
    "field_paths": {
      "<output_field>": "<sub-selector applied to each match>"
    }
  } | null,
  "rationale": "<≤500 chars explaining the choice>",
  "confidence": 0.0–1.0
}
`.trim();

export function selectorRederiveUserPrompt(input: {
  sourceId: string;
  oldSelector: unknown;
  oldHtmlSnippet: string;
  newHtml: string;
  expectedFields: ReadonlyArray<string>;
}): string {
  return [
    `<source_id>${input.sourceId}</source_id>`,
    `<old_selector>${JSON.stringify(input.oldSelector, null, 2)}</old_selector>`,
    `<old_html_snippet>`,
    input.oldHtmlSnippet.slice(0, 8_000),
    `</old_html_snippet>`,
    `<new_html>`,
    input.newHtml.slice(0, 30_000),
    `</new_html>`,
    `<expected_fields>${input.expectedFields.join(', ')}</expected_fields>`,
  ].join('\n');
}
