# DECISION-020 — DL380 cluster hardware tier: AI / Security Node spec

| Field      | Value                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-05-15                                                                                                                    |
| Decided by | Junior Thuram Nana, Sovereign Architect                                                                                       |
| Status     | **FINAL** (procurement intent)                                                                                                |
| Supersedes | The leaner DL380 spec previously documented in `~/.claude/plans/crispy-pondering-teapot.md` §"Hardware specification"         |
| Affects    | Phase 2 cluster migration; `infra/k8s/charts/vigil-apex/values-cluster.yaml`; future DECISION-011 (AI safety doctrine) review |

---

## Decision

The 3-node Phase-2 cluster (Yaoundé primary site) procures **HPE ProLiant
DL380 Gen11 servers in the "Fully Loaded AI / Security Node" configuration**:

| Component                                                             | Spec                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Chassis                                                               | HPE ProLiant DL380 Gen11 8 SFF + 8 SFF rear (16 NVMe bays total)                                                                |
| CPU                                                                   | 2× Intel Xeon **Platinum 8xxx-series** (32–40 cores per socket, target Platinum 8462Y+ or 8490H per availability)               |
| Memory                                                                | **1 TB+ DDR5-5200 RDIMM** (16× 64 GB or 32× 32 GB; 32 slots populated; expansion path to 8 TB per node)                         |
| Storage controller                                                    | HPE MR416i-o Gen11 Tri-Mode (12 Gb SAS/SATA + NVMe), 4 GB FBWC                                                                  |
| Boot                                                                  | 2× 480 GB M.2 NVMe on HPE NS204i-u Boot Controller (hardware RAID-1)                                                            |
| Hot tier (Postgres, Vault, Redis, Fabric, IPFS metadata, audit chain) | 4× **1.92 TB U.3 NVMe SSD** in RAID-10 → ~3.84 TB usable                                                                        |
| Warm tier (Neo4j, Logstash, Prometheus, IPFS pinset)                  | 8× **3.84 TB U.3 NVMe SSD** in RAID-10 → ~15.36 TB usable (replaces the previously-planned SAS HDD bulk tier)                   |
| Bulk tier                                                             | Eliminated — all storage NVMe                                                                                                   |
| GPUs                                                                  | **4–8× NVIDIA L4** (24 GB GDDR6, 72 W TDP, single-slot half-height) per node. Cluster total: 12–24 L4s; 288–576 GB pooled VRAM. |
| Network                                                               | HPE Ethernet 10/25 Gb 2-port 631FLR-SFP28 (LACP bond, cluster interconnect) + HPE 1 Gb 4-port 366FLR (management VLAN)          |
| Management                                                            | HPE iLO 6 Advanced licence + iLO Amplifier Pack                                                                                 |
| Power                                                                 | 2× HPE 1600 W Flex Slot Platinum Hot-Plug PSU (A+B feeds on independent PDU circuits)                                           |
| Trust                                                                 | HPE TPM 2.0 Gen11 Option Kit (measured boot anchor for LUKS2 + clevis)                                                          |
| Warranty                                                              | HPE Foundation Care 24×7, 4-hour onsite response, 3 years                                                                       |

**Per-node hardware budget:** ~$55–80 k USD.
**Cluster of 3:** ~$165–240 k USD before tax/shipping/install.
**UPS + rack PDUs + 25 GbE switches:** additional ~$15–20 k.

This supersedes the leaner spec in the cluster-migration plan, which
targeted Xeon Gold 6442Y / 256 GB RAM / tiered NVMe+SAS / no GPUs (per-node
~$28–35 k, cluster ~$85–105 k).

---

## What changed from the leaner spec

| Component    | Was                                                       | Now                                                    | Delta                                       |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| CPU          | Xeon Gold 6442Y (24c × 2)                                 | Xeon Platinum 8xxx (32c+ × 2)                          | +1 tier; ~+30% core count; ~+$3–5 k per CPU |
| RAM          | 256 GB (expandable to 768)                                | **1 TB+**                                              | ~4× capacity                                |
| Storage      | 3.84 TB hot NVMe + 7.68 TB warm NVMe + 16 TB SAS HDD bulk | 3.84 TB hot NVMe + 15.36 TB warm NVMe; **no HDD bulk** | All-NVMe; ~$10 k more per node              |
| GPU          | None in Phase 1–2; Phase 3 optional: 1× L40S/H100         | **4–8× L4 integrated**                                 | $11–22 k per node; new scope                |
| Role framing | General storage/compute                                   | **AI / Security Node**                                 | New role                                    |

---

## Rationale

Three drivers:

1. **Local LLM inference becomes a first-class capability.** 4–8× NVIDIA L4
   per node (~96–192 GB VRAM per node; 288–576 GB cluster pool) runs
   Qwen-72B-Instruct-Q4 or DeepSeek-V3-Q4 with comfortable headroom — both
   are within VIGIL's binding-doc framing of "AI provider must be operable
   offline / under jurisdictional pressure." Today's Anthropic + Bedrock
   providers are remote-only; a local-Qwen / local-DeepSeek provider is
   the credible fallback when an Anthropic outage, Bedrock rate-limit, or
   geopolitical event cuts cloud access. This is the M5+ binding posture
   (per `docs/source/AI-SAFETY-DOCTRINE-v1.md` DECISION-011 §"Operational
   continuity under provider loss").

2. **GPU-class workloads become viable.** ZK proof generation
   (rapidsnark) for the council-vote ceremony, satellite-imagery ML
   (NDVI/NDBI/built-up classification beyond the current
   `worker-satellite` `compute_activity`), image-forensics ML (font
   anomaly, signature similarity in `worker-image-forensics`), and
   embedding generation for entity-resolution + dossier semantic search
   all want GPU. The L4 (compute-class Ada Lovelace) is the
   power-envelope-friendly choice (72 W vs L40S's 350 W vs H100's 350 W)
   — 8× L4 fits inside one DL380's PCIe + power budget without
   throttling, where 8× H100 would not.

3. **"Security Node" role is the systemic framing.** A node with GPU +
   1 TB RAM can run:
   - Real-time NIDS/HIDS workloads (Suricata + Falco rules engine)
   - Behavior-anomaly detection on audit chain (Bayesian + LLM-classifier
     ensemble)
   - Mid-flight memory inspection for compromise indicators
   - Locally-served embedding index for fast cross-witness reconciliation

   These don't exist as workers today — they're the post-Phase-2 capability
   the loaded spec unlocks. None are gated on Phase 1–2 closure; all are
   "available when needed."

---

## Implications + new scope unlocked

### Code-side (Phase 2+ work, not blocking Phase 1)

1. **New LLM provider** `packages/llm/src/providers/local-qwen.ts` (or
   `local-deepseek.ts`, or both). Speaks the existing `LlmProvider`
   interface; calls into a local vLLM / TGI / llama.cpp server bound to
   the node's GPUs.

2. **k3s NVIDIA device plugin** + CUDA-bearing worker base images. The
   current `node:20-alpine` worker base has no GPU runtime; GPU-using
   workers need `nvidia/cuda:12.x-runtime-ubuntu24.04` or equivalent.
   Workers that don't need GPU stay on alpine.

3. **`infra/k8s/charts/vigil-apex/values-cluster.yaml` updates:**
   - Resource limits bumped 4× for memory-heavy services (Neo4j to 64 GB
     heap, Postgres `shared_buffers` to 256 GB, IPFS pin-cache to 32 GB).
   - GPU resource declarations (`nvidia.com/gpu: N`) on the workloads
     that use them: a new `worker-local-llm` Deployment, `worker-zk-prove`
     for council-vote ZK proofs, `worker-image-forensics` (CUDA acceleration
     for the existing CPU pipeline), `worker-satellite` (Rasterio +
     CUDA for the existing NDVI/NDBI math + future ML extensions).
   - `nodeSelector: nvidia.com/gpu.present="true"` on the GPU pods.

4. **Storage strategy simplifies.** With no HDD bulk tier, the
   hot/warm split collapses to a single NVMe pool per node. The
   `local-path-provisioner` config in `values-cluster.yaml` can drop the
   bulk-PVC stanza.

### Doctrinal review trigger

**DECISION-011 (AI-SAFETY-DOCTRINE-v1.md) needs a review pass** before any
local-LLM provider lands. The 16 LLM-failure-mode defences assume:

- Remote LLM (closed weights at provider) — local Qwen/DeepSeek has open
  weights stored on disk; the failure-mode #8 ("model poisoning at the
  provider") moves from "provider's problem" to "ours."
- Provider audit logs are the call-record source — local inference
  generates no remote audit trail; we must produce our own (audit-chain
  entry per inference call, including the prompt sha256 + the response
  sha256 + the model+version+quantisation tag).
- Failure-mode #14 ("prompt-injection at the LLM layer") may have new
  attack surface via the model file itself (a poisoned `.safetensors` /
  `.gguf` weight file). Mitigation: sha256-verify model weights at load
  - sign them with the same cosign chain we'll land in Phase 12.

This review is **NOT** a Phase 2 blocker — local LLMs come online when
the architect picks them up. The review must precede the first call.
Tracked as a follow-up decision.

### Procurement order-of-events

1. **First node** delivered + DR-rehearsed before nodes 2 and 3 are
   procured. Catches DOA / firmware-drift issues before the full $165 k+
   commit.
2. **GPUs ordered separately** with longer lead time (NVIDIA L4 supply
   has been tight in 2025–2026). Nodes can run without GPUs for the
   non-AI workloads; GPU slots stay empty until L4s arrive.
3. **HPE Foundation Care contract activated on first node delivery
   date** — the 3-year clock starts then, not when all 3 land.

---

## What this decision does NOT include

- **Phase 1 hardware.** The architect's MSI Titan + Synology continues
  to host Phase 1 (data plane scaffold + first 90-mode hardening pass).
  This decision applies to the Phase 2 Yaoundé cluster procurement
  ONLY.

- **CONAC / Cour des Comptes / institution-side hardware.** Those
  Phase 2.5+ federation peers are out of scope; CONAC will run their
  own hardware per their own procurement process.

- **Hetzner N02 off-jurisdiction node.** That's the existing CPX31 +
  upgrade plan; not affected.

- **Specific LLM model commitments.** Whether the local LLM is
  Qwen-72B, DeepSeek-V3, Llama-3.1-70B, or some combination is a
  separate decision driven by the calibration-evaluator output
  (DECISION-014c) once the first inference workloads are exercised.

- **Locking in a specific Xeon Platinum SKU.** "Platinum 8xxx-series"
  is the policy; the specific SKU (8462Y+ vs 8490H vs whatever is on
  HPE's price-availability sheet at order time) is left to procurement
  optimisation.

---

## Files touched

- `docs/decisions/decision-020-dl380-ai-security-tier.md` (this file)
- `docs/decisions/log.md` (one-line entry)
- `infra/k8s/charts/vigil-apex/values-cluster.yaml` (resource bumps + GPU sections + reference to this decision)

---

## Re-open trigger

Re-open if:

1. **NVIDIA L4 supply lead time exceeds 6 months at order date.**
   Fall back to: (a) L40S (350 W) if power envelope allows, or (b)
   ship without GPUs and procure when supply returns.
2. **Per-node total cost exceeds $90 k.** Re-scope to the leaner spec
   (Xeon Gold + 512 GB RAM + 2× L4 per node) and document the trade.
3. **DECISION-011 review concludes local-LLM is too risky to ship**
   for some failure mode not yet identified. Then the GPUs become
   bonus capacity for non-LLM workloads (ZK proofs, ML satellite,
   image forensics).
