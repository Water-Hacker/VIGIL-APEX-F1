# Archived dashboards (Block-D 2026-05-01)

> Per Block-C plan §3 hold-point #1 / architect resolution
> option (c) **map+add+archive**: the canonical Phase-1 dashboard
> set is the **6 dashboards** the architect spec'd in C4 (data
> plane / workers / LLM / findings pipeline / governance /
> operator overview). The 14 existing dashboards in this directory
> at the start of Block D are NOT discarded — they are archived
> here with a one-sentence justification per file. Operators who
> need a legacy view can opt-in by symlinking from this directory
> back into the canonical path.
>
> **Single source of truth for "why isn't there a dashboard for
> X?" questions** (architect spec).

---

## Per-file disposition

| File                        | Status                                           | One-sentence justification                                                                                                                    |
| --------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `vigil-overview.json`       | **Superseded** by `vigil-operator-overview.json` | Same role (operator home page); the new version uses the architect's six-dashboard linking + tighter KPI selection per C4 spec.               |
| `vigil-findings.json`       | **Superseded** by `vigil-findings-pipeline.json` | Same domain; the new version adds the scoring-tier distribution + counter-evidence hold rate + posterior histogram per C4 spec.               |
| `vigil-cost.json`           | **Superseded** by `vigil-llm.json`               | LLM cost subsumed into the LLM dashboard (which also covers calls + hallucination + provider tier + schema-validation per C4 spec).           |
| `llm-cost-per-finding.json` | **Superseded** by `vigil-llm.json`               | Per-finding cost is one panel in the LLM dashboard rather than its own dashboard.                                                             |
| `pattern-fire-rate.json`    | **Superseded** by `vigil-findings-pipeline.json` | Per-pattern detection rate is one panel in the findings dashboard.                                                                            |
| `calibration-bands.json`    | **Superseded** by `vigil-findings-pipeline.json` | ECE + posterior distribution are panels in the findings dashboard.                                                                            |
| `council-vote-lag.json`     | **Superseded** by `vigil-governance.json`        | Vote-to-tally lag is one panel in the governance dashboard.                                                                                   |
| `vigil-adapters.json`       | **Superseded by KPI in operator-overview**       | Adapter-specific dashboard not in the architect's 6; the failure-rate KPI lands on the operator overview. Detailed per-adapter view archived. |
| `ingestion-throughput.json` | **Out-of-scope-for-MVP**                         | Per-source throughput is granular ops; not in the architect's 6. Operator alert via `AdapterFailing` rule covers the actionable axis.         |
| `tip-volume.json`           | **Out-of-scope-for-MVP**                         | Tip portal volume is an investigation lens; not in the architect's 6. Tip workflow visibility lives in the operator triage UI.                |
| `audit-chain-tail.json`     | **Superseded by KPI in operator-overview**       | Audit seq head landed on the operator-overview dashboard as a single KPI.                                                                     |
| `vigil-audit-chain.json`    | **Phase-2-only**                                 | Audit-chain witness reconciliation visualisation; relevant when Fabric multi-org goes live (Phase-2). Not in Phase-1 critical path.           |
| `polygon-anchor-cost.json`  | **Phase-7-only**                                 | Polygon anchor cost is a Phase-7 concern (CONAC mainnet cutover). Tracked in cost reports + LLM dashboard's USD-rolled KPI for now.           |
| `vigil-fabric.json`         | **Phase-2-only**                                 | Hyperledger Fabric peer health; Phase-2 scaffold only. Relevant when multi-org peers come online.                                             |

## Re-activation

To bring an archived dashboard back into the canonical set:

```sh
ln -s ../archive-from-block-d/<dashboard>.json infra/docker/grafana/dashboards/
docker compose restart vigil-grafana
```

The dashboard JSONs are unchanged from their pre-Block-D state.
Re-activation is a 1-line operation.

## Forward policy

New dashboard requests start with: "what change in the architect's
6 would render this redundant?" If the answer is "nothing — the
new dashboard fills a genuinely missing axis," it lands in the
canonical path; otherwise it lands here with an entry in the
table above. The table is the human-readable contract; the
canonical path is the operator's tab bar.
