# VIGIL APEX User-Visible Surfaces Audit

**Audit Date:** 2026-05-10
**Codebase Root:** /home/kali/Documents/vigil-apex
**Dashboard Root:** apps/dashboard/src/app

## Executive Summary

This document inventories every user-visible surface in the VIGIL APEX dashboard application (apps/dashboard), including route patterns, authentication gates, middleware enforcement, layout chains, and data flows. The platform follows a clean route-group architecture with minimal layout nesting. Middleware uniformly enforces role-based access control at the edge; page-level guards are minimal because routing decisions happen at request time.

No layout.tsx files exist below apps/dashboard/src/app/layout.tsx; all pages mount directly on the root layout.

---

## A. Operator Dashboard Routes

**Middleware enforcement:** apps/dashboard/src/middleware.ts:61–78
**Route rules:** Roles {operator, auditor, architect} for `/findings`, `/dead-letter`, `/calibration`; {tip_handler, architect} for `/triage`; {auditor, architect} for `/audit`.
**Forbidden-access response:** middleware.ts:156–158 (rewrite to /403; no JSON on HTML requests).

### /findings (GET, HTML)

- **Page file:** apps/dashboard/src/app/findings/page.tsx:14
- **Middleware gate:** middleware.ts:62 — requires role ∈ {operator, auditor, architect}
- **Page guard:** none (middleware trust)
- **Layout chain:** RootLayout (layout.tsx:30–51)
- **Authentication required:** JWT-bearing with valid Keycloak role
- **Data sources read:** `listFindings()` (lib/findings.server.ts) — SELECT findings with posterior > 0.55; Classification levels rendered inline (critical→restreint, high→confidentiel, low→public)
- **Write operations:** none
- **i18n:** Static labels (title "Findings", hardcoded English); no message keys loaded
- **Classification banner:** Inline badges per finding severity rendered directly in findings/page.tsx:41
- **NavBar visibility:** OPERATOR_LINKS:16 (nav-bar.tsx)

### /findings/[id] (GET, HTML)

- **Page file:** apps/dashboard/src/app/findings/[id]/page.tsx:41
- **Middleware gate:** inherits from `/findings` prefix (middleware.ts:62)
- **Page guard:** notFound() if finding not found (findings/[id]/page.tsx:46)
- **Data sources read:** `getFindingDetail()`, `getLatestAssessment()` — AI safety certainty metrics
- **Write operations:** SatelliteRecheckButton (client-side, triggers /api/findings/[id]/recheck)
- **i18n:** Loaded (getLocale, loadMessages); finding title/summary in fr/en

### /dead-letter (GET, HTML)

- **Page file:** apps/dashboard/src/app/dead-letter/page.tsx:8
- **Middleware gate:** middleware.ts:63 — requires role ∈ {operator, architect}
- **Data sources read:** `listDeadLetter({ resolved: false, limit: 200 })`
- **i18n:** Loaded; message keys 'dead_letter.title', 'dead_letter.empty', etc.

### /calibration (GET, HTML)

- **Page file:** apps/dashboard/src/app/calibration/page.tsx:14
- **Middleware gate:** middleware.ts:64 — requires role ∈ {operator, architect}
- **Data sources read:** `getCalibrationView()` — latest ECE, Brier, per-pattern metrics

### /calibration/reliability (GET, HTML)

- **Page file:** apps/dashboard/src/app/calibration/reliability/page.tsx:112
- **Middleware gate:** inherits /calibration prefix (middleware.ts:64)

### /audit/ai-safety (GET, HTML)

- **Page file:** apps/dashboard/src/app/audit/ai-safety/page.tsx:51
- **Middleware gate:** middleware.ts:67 — requires role ∈ {auditor, architect}
- **Data sources read:** `getAiSafetyHealth(24)` — Claude call counts, canary triggers, schema violations, hallucination rate

### /triage/tips (GET, HTML)

- **Page file:** apps/dashboard/src/app/triage/tips/page.tsx:9
- **Middleware gate:** middleware.ts:66 — requires role ∈ {tip_handler, architect}
- **Data sources read:** `TipRepo.listForTriage(50)` — encrypted tips awaiting decryption/triage (plaintext NOT fetched)
- **Write operations:** TipDecryptForm (client; calls /api/triage/tips/decrypt POST with quorum shares)

### /triage/adapter-repairs (GET, HTML)

- **Page file:** apps/dashboard/src/app/triage/adapter-repairs/page.tsx:8
- **Middleware gate:** inherits /triage prefix (middleware.ts:66)

---

## B. Council Portal Routes

**Middleware enforcement:** middleware.ts:65
**Route rules:** Role {council_member, architect}

### /council/proposals (GET, HTML)

- **Page file:** apps/dashboard/src/app/council/proposals/page.tsx:5
- **Middleware gate:** middleware.ts:65 — requires role ∈ {council_member, architect}
- **Data sources read:** `listOpenProposals()` — governance proposals with vote tallies
- **i18n:** Hardcoded English ("Council — open proposals", "14-day vote window per SRD §23.4") — **bilingual drift finding**

### /council/proposals/[id] (GET, HTML)

- **Page file:** apps/dashboard/src/app/council/proposals/[id]/page.tsx:14
- **Page guard:** notFound() if proposal not found (page.tsx:18)
- **Write operations:** VoteCeremony component (client; requires WebAuthn/Yubikey touch → POST /api/council/proposals/[id]/vote)

---

## C. Public Surfaces

**Middleware enforcement:** middleware.ts:37–53
**Public paths:** /, /tip*, /verify*, /ledger, /public, /privacy, /terms, /api/tip/_, /api/verify/_, /api/audit/public, /api/audit/aggregate
**Authentication:** None required; identity headers stripped (middleware.ts:110–112).

### / (GET, HTML)

- **Page file:** apps/dashboard/src/app/page.tsx:5
- **i18n:** Hardcoded English throughout (page.tsx:8–91); no i18n keys loaded — **bilingual drift finding**
- **FINDING-001:** Root page title (layout.tsx:25) says "Real-Time Public Finance Compliance, Governance Monitoring & Intelligence Platform" but should present as public anti-corruption service, not internal "Intelligence Platform". Suggests operator-facing branding on the public home.

### /tip (GET, HTML)

- **Page file:** apps/dashboard/src/app/tip/page.tsx:62
- **Data sources read:** Client fetch `/api/tip/public-key` — operator public key for client-side encryption
- **Write operations:**
  - Browser-side libsodium sealed-box encryption (tip/page.tsx:109–119)
  - POST `/api/tip/submit` with ciphertext + Turnstile token (plaintext NEVER sent to server)
  - POST `/api/tip/attachment` for encrypted file uploads (plaintext handled entirely in browser)
- **Encryption:** libsodium-wrappers-sumo (real, not stub) verified in tip/page.tsx:109 (dynamic import)
- **Security hardening (verified):**
  - Client-side sanitization before encryption (TIP_ATTACHMENT_LIMITS validation)
  - Image re-encode via canvas (EXIF/ICC/IPTC stripped) in attachment-picker.tsx:304–344
  - Magic-byte validation + canonical-base64 verification (submit/route.ts:115–189)
  - Turnstile CAPTCHA integration (SRD §28.5)
  - No IP address stored in schema (packages/db-postgres/src/schema/tip.ts:19–43 confirms no ip_address column)
  - No third-party analytics (grep found only Google Fonts import, no gtag/analytics/segment)
- **i18n:** Fully bilingual (French primary, English secondary); page.tsx:176–300 covers both languages inline

### /tip/status (GET, HTML)

- **Page file:** apps/dashboard/src/app/tip/status/page.tsx:11
- **Data sources read:** Client fetch `/api/tip/status?ref={TIP-YYYY-NNNN}` — disposition only (no decryption)

### /verify (GET, HTML)

- **Page file:** apps/dashboard/src/app/verify/page.tsx:7
- **i18n:** Hardcoded English (page.tsx:9–29); no i18n loaded — **bilingual drift finding**

### /verify/[ref] (GET, HTML)

- **Page file:** apps/dashboard/src/app/verify/[ref]/page.tsx:14
- **Page guard:** notFound() if dossier not found (page.tsx:16)
- **Data sources read:** `getVerifyView(params.ref)` — dossier metadata, PDF hashes (SHA-256), IPFS CIDs, Polygon anchor TX

### /ledger (GET, HTML)

- **Page file:** apps/dashboard/src/app/ledger/page.tsx:57
- **Data sources read:** `loadCheckpoints()` (page.tsx:20), `loadMonthly()` (page.tsx:39), env NEXT_PUBLIC_POLYGON_EXPLORER

### /public/audit (GET, HTML)

- **Page file:** apps/dashboard/src/app/public/audit/page.tsx:73
- **Data sources read:** `repo.aggregateCounts(...)`, `repo.listPublic(...)`, transformation `toPublicView()` redacts PII per category (page.tsx:88–100)
- **TAL-PA compliance:** Page correctly implements public-view redaction per TAL-PA-v1 doctrine

### /privacy (GET, HTML)

- **Page file:** apps/dashboard/src/app/privacy/page.tsx:8
- **i18n:** Content fully bilingual (fr/en inline)
- **Privacy claims (as published):** All three verified against code (no ip_address column, middleware logs via audit emit, /api/triage/tips/decrypt requires quorum shares)

### /terms (GET, HTML)

- **Page file:** apps/dashboard/src/app/terms/page.tsx:5
- **i18n:** Content fully bilingual

### /403 (GET, HTML)

- **Page file:** apps/dashboard/src/app/403/page.tsx:5
- **Middleware gate:** Accessed via internal rewrite only (middleware.ts:157); not directly routable
- **i18n:** Loaded; message keys 'auth.forbidden_title', 'auth.forbidden_body'

---

## D. Civil Society Portal (Read-Only)

**Middleware enforcement:** middleware.ts:70
**Route rules:** Role {civil_society, auditor, architect}; read-only per middleware.ts:68–69

### /civil-society/audit-log (GET, HTML)

- **Page file:** apps/dashboard/src/app/civil-society/audit-log/page.tsx:11
- **Data sources read:** `listAuditLogPage({ cursor, limit: 100 })` — masked audit entries per W-15
- **i18n:** Hardcoded English — **bilingual drift finding**

### /civil-society/council-composition (GET, HTML)

- **Page file:** apps/dashboard/src/app/civil-society/council-composition/page.tsx:5
- **Data sources read:** `listCouncilComposition()` — pillar seat status; individual identities NOT exposed (per EXEC §13)
- **i18n:** Hardcoded English — **bilingual drift finding**

### /civil-society/proposals-closed (GET, HTML)

- **Page file:** apps/dashboard/src/app/civil-society/proposals-closed/page.tsx:7
- **Data sources read:** `listClosedProposals(100)` — vote tallies, proposal IDs; entity names redacted per W-15
- **i18n:** Hardcoded English — **bilingual drift finding**

---

## E. Forbidden-Access Trace (Representative Operator Route)

**Scenario:** Unauthenticated user or user with role {tip_handler} attempts to access `/findings` (operator-only).

### Step 1: Request hits middleware

- **File:** apps/dashboard/src/middleware.ts:103–178
- **Check isPublic(/findings):** false (not in PUBLIC_PREFIXES, middleware.ts:80–84)

### Step 2: Token verification

- **Lines:** middleware.ts:120–146
- **Case A - No cookie:** Redirect to `/auth/login?next=/findings` (middleware.ts:126–128)
- **Case B - Invalid token:** Same redirect after jwtVerify fails (middleware.ts:138–145)

### Step 3: Role check (assuming valid token with wrong role)

- **Line:** middleware.ts:148–159
- **matchRule("/findings"):** returns { prefix: '/findings', allow: ['operator', 'auditor', 'architect'] } (middleware.ts:62)
- **rolesFromToken(payload):** extracts realm_access.roles + resource_access['vigil-dashboard'].roles (middleware.ts:95–101)
- **allowed = rule.allow.some(r => roles.has(r)):** false if token role is {tip_handler}

### Step 4: Forbidden response

- **Line:** middleware.ts:156–158
- **HTML request:** `url.pathname = '/403'; return NextResponse.rewrite(url);`
- **This rewrites the URL to /403 WITHOUT redirect** — browser shows /findings in address bar, but page content is from 403/page.tsx

### Step 5: 403 page render

- **File:** apps/dashboard/src/app/403/page.tsx:5–14
- **Renders:** i18n-loaded header + body with 'auth.forbidden_title' and 'auth.forbidden_body' keys

### Step 6: Audit emission

- **NOT performed in middleware** — the rewrite is silent
- **Assumption:** /403 page itself calls an audit emission route (not found in static analysis; likely in a layout or useEffect)
- **Verdict:** No explicit audit emission found for forbidden access in middleware or 403 page.
- **FINDING-002 (CRITICAL):** Forbidden-access attempts not logged to audit chain.

---

## F. Navigation Visibility Matrix

All operator/council/triage/audit routes visible through OPERATOR_LINKS or CIVIC_LINKS in nav-bar.tsx:15–31. Public surfaces visible in CIVIC_LINKS. Civil-society visible in CIVIC_LINKS but nav rendering does not distinguish role-gated vs. public — role check happens at middleware + page load time, not nav construction.

**NavBar rendering:** layout.tsx:44 passes currentPath; nav-bar.tsx:34–35 implements isActive() check for visual highlighting only.

**FINDING-004 (CRITICAL):** OPERATOR_LINKS and CIVIC_LINKS both render unconditionally in NavBar (nav-bar.tsx:43–60). NavBar is imported in root layout (layout.tsx:4, 44), wrapping all pages including public ones (/tip, /verify, /ledger, /public/audit). An unauthenticated user visiting /tip will see the full nav bar with "Findings", "Tip triage", "Dead-letter", "Calibration", "AI safety audit" links. The links are non-functional (middleware blocks) but leak the existence of operator routes — violates information-hiding (SRD §15 "masking").

**Reproduction:**

1. Open /tip (public page, no auth required)
2. Observe NavBar renders OPERATOR_LINKS:16–22
3. Click any OPERATOR_LINKS link (e.g., /findings)
4. Middleware rejects with 302 to /auth/login

No role-switcher UI found. No classification banner component found outside finding/page.tsx inline rendering.

---

## G. Summary of Findings

| ID       | Severity | Issue                                                                                                         | Evidence                                                                     |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| FIND-S01 | LOW      | Root page branding ("Intelligence Platform") suggests operator-facing context despite being public home       | layout.tsx:26; page.tsx:10                                                   |
| FIND-S02 | CRITICAL | Forbidden-access attempts (middleware rewrite to /403) not logged to audit chain                              | middleware.ts:156–158 is silent; 403/page.tsx has no audit emit call visible |
| FIND-S03 | MEDIUM   | OPERATOR_LINKS rendered unconditionally in NavBar, visible to unauthenticated users on public pages           | nav-bar.tsx:43–60 + layout.tsx:44 (no role check in nav render)              |
| FIND-S04 | LOW      | Several pages have hardcoded English labels (no i18n keys): /, /verify, /council/proposals, /civil-society/\* | Multiple page files; bilingual discipline drift                              |

**No findings observed:** classification banner presence/correctness on public surfaces, public surfaces leaking operator routes (only nav links), third-party analytics, IP logging in tip schema, hardcoded secrets in client bundle.
