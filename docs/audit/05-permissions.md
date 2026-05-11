# VIGIL APEX RBAC & Capabilities Audit

**Audit Date:** 2026-05-10
**Codebase Root:** /home/kali/Documents/vigil-apex

## Executive Summary

VIGIL APEX uses a middleware-enforced role-based access control (RBAC) model. There is no separate capability matrix enum or build-time RBAC file; all authorization logic is inline in `apps/dashboard/src/middleware.ts`. The pattern that an external technical reviewer might expect — a single capability matrix file with explicit `audit:view` / `audit:read` capability strings — does not exist in this codebase. Instead, roles are matched directly against URL prefixes.

This is a viable security model (it works), but it diverges from the audit spec's mental model of "capability matrix integrity" — there are no capabilities, only role allow-lists.

We audit by comparing three sets:

- **Set A:** Route prefixes defined in middleware.ts:61–78 (ROUTE_RULES)
- **Set B:** Pages found in filesystem under apps/dashboard/src/app/
- **Set C:** Runtime guards in page components (notFound, etc.)

---

## 2.1 Capability Matrix Integrity

### Canonical RBAC Definition

**File:** apps/dashboard/src/middleware.ts:61–78
**Structure:** ROUTE_RULES array; each entry maps a URL prefix to an allow-list of roles.

```typescript
const ROUTE_RULES: ReadonlyArray<RouteRule> = [
  { prefix: '/findings', allow: ['operator', 'auditor', 'architect'] },
  { prefix: '/dead-letter', allow: ['operator', 'architect'] },
  { prefix: '/calibration', allow: ['operator', 'architect'] },
  { prefix: '/council', allow: ['council_member', 'architect'] },
  { prefix: '/triage', allow: ['tip_handler', 'architect'] },
  { prefix: '/audit', allow: ['auditor', 'architect'] },
  {
    prefix: '/civil-society',
    allow: ['civil_society', 'auditor', 'architect'],
  },
  { prefix: '/api/findings', allow: ['operator', 'auditor', 'architect'] },
  { prefix: '/api/dead-letter', allow: ['operator', 'architect'] },
  { prefix: '/api/calibration', allow: ['operator', 'architect'] },
  { prefix: '/api/council', allow: ['council_member', 'architect'] },
  { prefix: '/api/triage', allow: ['tip_handler', 'architect'] },
  { prefix: '/api/dossier', allow: ['operator', 'auditor', 'architect'] },
];
```

**Roles in use (extracted from allow-lists):**

- operator
- auditor
- architect
- council_member
- tip_handler
- civil_society

**FINDING-P01 (MEDIUM):** No role enum exists in `packages/security/src` or `apps/dashboard/src/lib/`. Roles are hardcoded strings in middleware. A typo in one allow-list (e.g., `'councl_member'`) would silently lock out the entire role. Recommended fix: extract `Role` union type to `packages/security/src/roles.ts` with TypeScript literal types.

### Cross-Check: Set A vs. Set B vs. Set C

**Set A (middleware.ts ROUTE_RULES):**

- /findings, /dead-letter, /calibration, /council, /triage, /audit, /civil-society
- API: /api/findings, /api/dead-letter, /api/calibration, /api/council, /api/triage, /api/dossier

**Set B (filesystem pages):**

- /findings/page.tsx (route exists in middleware ✓)
- /findings/[id]/page.tsx (prefix /findings in middleware ✓)
- /dead-letter/page.tsx (route exists ✓)
- /calibration/page.tsx (route exists ✓)
- /calibration/reliability/page.tsx (prefix /calibration in middleware ✓)
- /council/proposals/page.tsx (prefix /council in middleware ✓)
- /council/proposals/[id]/page.tsx (prefix /council ✓)
- /triage/tips/page.tsx (prefix /triage ✓)
- /triage/adapter-repairs/page.tsx (prefix /triage ✓)
- /audit/ai-safety/page.tsx (prefix /audit ✓)
- /civil-society/audit-log/page.tsx (prefix /civil-society ✓)
- /civil-society/council-composition/page.tsx (prefix /civil-society ✓)
- /civil-society/proposals-closed/page.tsx (prefix /civil-society ✓)

**Result:** All protected pages in Set B have matching entries in Set A. **No unmapped operator routes found.**

**Set C (runtime guards in pages):**

- findings/[id]/page.tsx:46 — notFound() if finding not found (retrieval guard, not role guard)
- council/proposals/[id]/page.tsx:18 — notFound() if proposal not found (retrieval guard)
- verify/[ref]/page.tsx:16 — notFound() if dossier not found (public surface; no auth required)

**No runtime capability checks found** (no assertCapability, requireCapability, hasCapability calls). All authorization happens at middleware via prefix + role matching.

### Live RBAC Matrix Screen

**Spec expects:** a live RBAC matrix screen that renders the same data the build-time tooling reads.

**Actual:** No live RBAC matrix screen found. No `/audit/rbac-matrix` route. No `RbacMatrix` component.

**FINDING-P02 (MEDIUM):** No live RBAC matrix screen exists. The capability state cannot be inspected by an operator at runtime. Recommended: build a read-only `/audit/rbac-matrix` page that imports ROUTE_RULES from middleware and renders it. (The spec section 7.1 explicitly asks for this.)

---

## 2.2 Role-by-Screen Walk

### Role Coverage

| Screen                  | Route                    | Roles Allowed (per code)          | Expected (per audit spec) | Verdict |
| ----------------------- | ------------------------ | --------------------------------- | ------------------------- | ------- |
| Findings list           | /findings                | operator, auditor, architect      | operator+                 | ✓       |
| Dead-letter             | /dead-letter             | operator, architect               | operator+                 | ✓       |
| Calibration             | /calibration             | operator, architect               | operator+                 | ✓       |
| AI Safety audit         | /audit/ai-safety         | auditor, architect                | auditor+                  | ✓       |
| Tip triage              | /triage/tips             | tip_handler, architect            | tip_handler+              | ✓       |
| Adapter repairs         | /triage/adapter-repairs  | tip_handler, architect            | tip_handler+              | ✓       |
| Council proposals       | /council/proposals       | council_member, architect         | council+                  | ✓       |
| Civil society audit-log | /civil-society/audit-log | civil_society, auditor, architect | civil society+            | ✓       |
| Public tip              | /tip                     | (public)                          | (public)                  | ✓       |
| Public verify           | /verify                  | (public)                          | (public)                  | ✓       |
| Public ledger           | /ledger                  | (public)                          | (public)                  | ✓       |
| Public audit            | /public/audit            | (public)                          | (public)                  | ✓       |

No divergences observed (each role sees what it should; no public→operator leak via direct page rendering).

---

## 2.3 Public Surface Hardening

### P1: No Operator Route Reachable from Public Surface ✓

Public pages contain no client-side navigation links to protected routes. Middleware prevents rendering of protected routes by URL manipulation.

### P2: No Operator Route String in Public Bundle ⚠

**Cannot fully verify without a built bundle.** Static analysis: no public page imports protected route components. However, the NavBar component (`nav-bar.tsx`) embeds OPERATOR_LINKS as string literals and is rendered on public pages (see FINDING-P03 below).

### P3: Classification Banner Does NOT Render on Public Surfaces ✓

Classification banner is rendered inline only on `findings/page.tsx:41`, which is operator-only.

### P4: Role Switcher Does NOT Render on Public Surfaces ✓

No role-switcher component found anywhere in the codebase.

### P5: Operator Navigation Does NOT Render on Public Surfaces ✗

**FINDING-P03 (CRITICAL — leaks operator routes):** OPERATOR_LINKS rendered unconditionally in NavBar (nav-bar.tsx:43–60). NavBar is imported in root layout (layout.tsx:4, 44), which wraps all pages including public ones (/tip, /verify, /ledger, /public/audit). An unauthenticated user visiting /tip sees the full nav bar with "Findings", "Tip triage", "Dead-letter", "Calibration", "AI safety audit" links.

**Reproduction:**

1. Open /tip (public page, no auth required)
2. Observe NavBar renders OPERATOR_LINKS:16–22
3. Click any OPERATOR_LINKS link (e.g., /findings)
4. Middleware rejects with 302 to /auth/login

**Severity rationale:** Links are non-functional due to middleware gate, but visibility of operator route names violates information hiding (SRD §15 "masking") and could aid reconnaissance for an attacker mapping the operator surface area.

### P6: Internal Counters Do NOT Render on Public Surfaces ✓

/ledger (public) only exposes monthly dossier delivery counts (output metrics) and 30-day Polygon checkpoint commits — no queue depth, no operational state.

### P7: Brand Sub-Line ⚠

**FINDING-P04 (LOW):** layout.tsx:26 title "Real-Time Public Finance Compliance, Governance Monitoring & Intelligence Platform" — the term "Intelligence Platform" is operator-internal terminology that should not appear on public pages. Recommended: split metadata title between public and operator layouts, with public reading e.g., "VIGIL APEX — Transparence et conformité financière publique de la République du Cameroun".

### P8: Document Title ✓

layout.tsx:24–28 sets `robots: 'noindex, nofollow'` correctly.

### P9: Tip Portal Does NOT Log IP Addresses ✓ VERIFIED

Schema: packages/db-postgres/src/schema/tip.ts:19–43 has NO ip_address or client_ip column. submit/route.ts:136–139 reads cf-connecting-ip / x-forwarded-for headers ONLY for Turnstile verification — never persists.

### P10: Tip Portal Does NOT Call Third-Party Analytics ✓ VERIFIED

No googletagmanager, google-analytics, segment.com, mixpanel, amplitude, hotjar, posthog references found in public pages.

### P11: Tip Portal Client-Side libsodium Encryption Real ✓ VERIFIED

- tip/page.tsx:109 — `const sodium = await import('libsodium-wrappers-sumo');`
- tip/page.tsx:111–119 — uses `sodium.default.crypto_box_seal()`
- attachment-picker.tsx:100, 266 — same dynamic import + crypto_box_seal call
- libsodium-wrappers-sumo is a real WASM port of libsodium with constant-time AEAD. Not a stub.

### P12: Public Bundle Does NOT Embed Server-Only Env Vars ✓ VERIFIED

Public pages access only NEXT*PUBLIC*\* env vars:

- tip/page.tsx:53 — NEXT_PUBLIC_TURNSTILE_SITEKEY
- ledger/page.tsx:61 + verify/[ref]/page.tsx:21 — NEXT_PUBLIC_POLYGON_EXPLORER
- privacy/page.tsx:6 — NEXT_PUBLIC_ANTIC_DECLARATION_URL

---

## Summary of RBAC Findings

| ID       | Severity | Issue                                                                                   | Evidence                                    |
| -------- | -------- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| FIND-P01 | MEDIUM   | No `Role` enum or capability matrix; roles are hardcoded strings (typo risk)            | middleware.ts:61–78                         |
| FIND-P02 | MEDIUM   | No live RBAC matrix screen (spec section 7.1 expects one)                               | No `/audit/rbac-matrix` route in filesystem |
| FIND-P03 | CRITICAL | Operator nav links visible to unauthenticated public users (leaks operator route names) | nav-bar.tsx:43–60 + layout.tsx:44           |
| FIND-P04 | LOW      | Public home page presents as "Intelligence Platform" (operator branding)                | layout.tsx:26; page.tsx:10                  |

**No findings observed** in: capability matrix divergence (no matrix exists — see P01); unmapped operator routes (all in middleware); hardcoded secrets in client bundle; third-party analytics; IP logging in tip schema.

---

## Recommendations

1. **Close FIND-P03 (critical):** Wrap OPERATOR_LINKS rendering in a role check using middleware-set `x-vigil-roles` header:

   ```typescript
   const h = await headers();
   const roles = (h.get('x-vigil-roles') ?? '').split(',').filter(Boolean);
   const isOperator = roles.some(r => ['operator', 'auditor', 'architect', 'tip_handler', 'council_member'].includes(r));
   {isOperator && <ul role="list" aria-label="operator">...</ul>}
   ```

2. **Close FIND-P02 (medium):** Build read-only `/audit/rbac-matrix/page.tsx` that imports `ROUTE_RULES` and renders the matrix. Gate behind `auditor`/`architect` role per spec.

3. **Close FIND-P01 (medium):** Define `Role` type in `packages/security/src/roles.ts` and import in middleware to fail at compile time on typos.

4. **Close FIND-P04 (low):** Public/operator metadata split via route group layouts.
