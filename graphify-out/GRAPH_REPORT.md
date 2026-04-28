# Graph Report - /home/kali/vigil-apex  (2026-04-28)

## Corpus Check
- 368 files · ~374,066 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1200 nodes · 2221 edges · 69 communities detected
- Extraction: 69% EXTRACTED · 31% INFERRED · 0% AMBIGUOUS · INFERRED: 686 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]

## God Nodes (most connected - your core abstractions)
1. `VigilError` - 65 edges
2. `map()` - 50 edges
3. `main()` - 47 edges
4. `GET()` - 39 edges
5. `POST()` - 27 edges
6. `now()` - 26 edges
7. `createLogger()` - 25 edges
8. `getDb()` - 23 edges
9. `VaultClient` - 18 edges
10. `GeoPoint` - 18 edges

## Surprising Connections (you probably didn't know these)
- `healthz()` --calls--> `GET()`  [INFERRED]
  /home/kali/vigil-apex/load-tests/locust-minfi-api.py → /home/kali/vigil-apex/apps/dashboard/src/app/api/tip/status/route.ts
- `pollStatus()` --calls--> `GET()`  [INFERRED]
  /home/kali/vigil-apex/load-tests/k6-tip-portal.js → /home/kali/vigil-apex/apps/dashboard/src/app/api/tip/status/route.ts
- `map()` --calls--> `isHolidayEve()`  [INFERRED]
  /home/kali/vigil-apex/packages/shared/src/result.ts → /home/kali/vigil-apex/packages/patterns/src/category-h/p-h-003-holiday-publication-burst.ts
- `now()` --calls--> `envelopeFixture()`  [INFERRED]
  /home/kali/vigil-apex/packages/shared/src/time.ts → /home/kali/vigil-apex/packages/federation-stream/src/sign.test.ts
- `envelopeWith()` --calls--> `now()`  [INFERRED]
  /home/kali/vigil-apex/apps/worker-federation-receiver/test/handlers.test.ts → /home/kali/vigil-apex/packages/shared/src/time.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (118): ABC, ActivityResult, BandStack, compute_activity(), _ndbi(), _ndvi(), Activity-score computation.  Strategy (deliberately simple, well-bounded):    1., A 3-D ndarray (T, H, W) for one band, plus pixel size in metres. (+110 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (65): decideProposal(), listPendingProposals(), AnifAmlScreenAdapter, tryRead(), dedupKey(), makeEvent(), getCalibrationView(), closePool() (+57 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (3): evt(), satWithObserved(), isHolidayEve()

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (36): AnthropicProvider, computeCostUsd(), constructor(), run(), BedrockProvider, CircuitBreaker, loadRedisPassword(), QueueClient (+28 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (26): AfdbAdapter, AnifAdapter, ArmpMainAdapter, BeacPaymentsAdapter, readSecretFile(), ColepsAdapter, CourDesComptesAdapter, DgbAdapter (+18 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (16): FastHttpUser, GovernanceRepo, detectLanguage(), DocumentWorker, pollStatus(), submitTip(), healthz(), make_request_payload() (+8 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (15): FabricBridge, FabricBridgeWorker, CapturingHandlers, getVerify(), louvain(), isPublic(), matchRule(), middleware() (+7 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (19): DossierRepo, buildManifest(), ConacSftpWorker, TipTriageWorker, toBase64(), gfDiv(), gfMul(), shamirCombine() (+11 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (26): FederationStreamClient, loadServiceCtor(), Exception, make_health_app(), Lightweight FastAPI app exposing /healthz and /metrics.  The Prometheus expositi, Start the health/metrics server as a background task. Returns the task., serve_health(), _handle() (+18 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (20): AdapterError, AuditChainError, AuthError, CaptchaBudgetExceededError, CouncilMemberConflictError, FidoVerificationError, GovernanceError, HashChainBrokenError (+12 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (9): main(), MtlsManager, initTracing(), withSpan(), KV-v2 reader + auto-renewing AppRole / file-token client., Background thread: renew the auth token every `interval_s` seconds., VaultClient, deploy() (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.08
Nodes (11): bodyHash(), canonicalise(), rowHash(), sortKeys(), AuditWitnessContract, KEY(), HashChain, LocalWalletAdapter (+3 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (9): FederationReceiverHandlers, envelopeWith(), DirectoryKeyResolver, VaultPkiKeyResolver, registerAdapter(), registerPattern(), Registry, makeSectoralAdapter() (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (8): asPatternId(), formatDossierRef(), newAuditEventId(), newEntityId(), newFindingId(), newSignalId(), EntityWorker, PID()

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (7): bayesianPosterior(), clamp(), logOdds(), sigmoid(), FindingRepo, CounterWorker, ScoreWorker

### Community 15 - "Community 15"
Cohesion: 0.13
Nodes (4): getLocale(), loadMessages(), PrivacyPage(), TermsPage()

### Community 16 - "Community 16"
Cohesion: 0.2
Nodes (16): assertGuardsPass(), l10EntityFormPreservation(), l11TemperatureBound(), l12NegativeExamples(), l1SchemaCompliance(), l2CitationRequired(), l3CidInContext(), l4InsufficientPath() (+8 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (2): FrozenClock, SystemClock

### Community 18 - "Community 18"
Cohesion: 0.26
Nodes (12): SignatureSimilarity, compare_signatures(), _load_grayscale(), _normalise(), Signature similarity assessment.  Two complementary signals combined into one sc, Threshold + crop-to-bounding-box + resize to a canonical shape., Compare two signature images. Higher score == more similar., _signature_png() (+4 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 0.27
Nodes (4): err(), mapErr(), ok(), tryCatch()

### Community 21 - "Community 21"
Cohesion: 0.42
Nodes (1): Neo4jClient

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 0.25
Nodes (1): GovernanceReadClient

### Community 24 - "Community 24"
Cohesion: 0.29
Nodes (1): CalibrationRepo

### Community 25 - "Community 25"
Cohesion: 0.25
Nodes (1): AuditRepo

### Community 26 - "Community 26"
Cohesion: 0.47
Nodes (3): generateQrPng(), classificationColour(), renderDossierDocx()

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (1): PromptRegistry

### Community 28 - "Community 28"
Cohesion: 0.4
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 0.4
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (2): async(), sha256Hex()

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **27 isolated node(s):** `Read the public key from PIV slot 9c and derive the address.`, `Build an EIP-1559 transaction, sign via YubiKey, broadcast.`, `Locust load test — MINFI /score API.  Phase F7. SLA target: p95 < 100ms @ 100 rp`, `AdapterError`, `LlmError` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 31`** (2 nodes): `sentry.client.config.ts`, `beforeSend()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `layout.tsx`, `RootLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (2 nodes): `loading.tsx`, `Loading()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (2 nodes): `not-found.tsx`, `NotFound()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `GlobalError()`, `error.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `run-now.tsx`, `RunNowButton()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `decrypt()`, `decrypt-form.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (2 nodes): `decide()`, `decision-form.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `vote-ceremony.tsx`, `submit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (2 nodes): `page.tsx`, `VerifyPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `lookup.tsx`, `lookup()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `hardhat.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `queries.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `drizzle.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `sentry.server.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `next.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `playwright.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `public-surfaces.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `main()` connect `Community 1` to `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 21`, `Community 23`, `Community 29`?**
  _High betweenness centrality (0.162) - this node is a cross-community bridge._
- **Why does `map()` connect `Community 1` to `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 11`, `Community 13`, `Community 14`, `Community 16`, `Community 20`, `Community 21`, `Community 26`, `Community 30`?**
  _High betweenness centrality (0.161) - this node is a cross-community bridge._
- **Why does `GET()` connect `Community 6` to `Community 0`, `Community 1`, `Community 5`, `Community 7`, `Community 8`, `Community 15`, `Community 16`?**
  _High betweenness centrality (0.160) - this node is a cross-community bridge._
- **Are the 54 inferred relationships involving `VigilError` (e.g. with `VaultClient` and `Thin wrapper over hvac for Vault KV-v2 reads + auto-token-renewal.  Mirrors `@vi`) actually correct?**
  _`VigilError` has 54 INFERRED edges - model-reasoned connections that need verification._
- **Are the 48 inferred relationships involving `map()` (e.g. with `renderDossierDocx()` and `.run()`) actually correct?**
  _`map()` has 48 INFERRED edges - model-reasoned connections that need verification._
- **Are the 28 inferred relationships involving `main()` (e.g. with `initTracing()` and `startMetricsServer()`) actually correct?**
  _`main()` has 28 INFERRED edges - model-reasoned connections that need verification._
- **Are the 33 inferred relationships involving `GET()` (e.g. with `_handle()` and `healthz()`) actually correct?**
  _`GET()` has 33 INFERRED edges - model-reasoned connections that need verification._