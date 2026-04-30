# VIGIL APEX — Fraud Pattern Index (43 patterns)

This file maps every documented fraud pattern to its location on disk and
its category. Auto-checked in CI by `apps/dashboard/__tests__/doc-banners.test.ts`
under the AUDIT-074 block — a new pattern doc without an entry here, or
an entry without a doc, fails the test.

| ID      | Category                 | Doc                        | Code                                                                         |
| ------- | ------------------------ | -------------------------- | ---------------------------------------------------------------------------- |
| P-A-001 | A — Procurement core     | [P-A-001.md](./P-A-001.md) | [packages/patterns/src/category-a/](../../packages/patterns/src/category-a/) |
| P-A-002 | A                        | [P-A-002.md](./P-A-002.md) | category-a                                                                   |
| P-A-003 | A                        | [P-A-003.md](./P-A-003.md) | category-a                                                                   |
| P-A-004 | A                        | [P-A-004.md](./P-A-004.md) | category-a                                                                   |
| P-A-005 | A                        | [P-A-005.md](./P-A-005.md) | category-a                                                                   |
| P-A-006 | A                        | [P-A-006.md](./P-A-006.md) | category-a                                                                   |
| P-A-007 | A                        | [P-A-007.md](./P-A-007.md) | category-a                                                                   |
| P-A-008 | A                        | [P-A-008.md](./P-A-008.md) | category-a                                                                   |
| P-A-009 | A                        | [P-A-009.md](./P-A-009.md) | category-a                                                                   |
| P-B-001 | B — Bid manipulation     | [P-B-001.md](./P-B-001.md) | [packages/patterns/src/category-b/](../../packages/patterns/src/category-b/) |
| P-B-002 | B                        | [P-B-002.md](./P-B-002.md) | category-b                                                                   |
| P-B-003 | B                        | [P-B-003.md](./P-B-003.md) | category-b                                                                   |
| P-B-004 | B                        | [P-B-004.md](./P-B-004.md) | category-b                                                                   |
| P-B-005 | B                        | [P-B-005.md](./P-B-005.md) | category-b                                                                   |
| P-B-006 | B                        | [P-B-006.md](./P-B-006.md) | category-b                                                                   |
| P-B-007 | B                        | [P-B-007.md](./P-B-007.md) | category-b                                                                   |
| P-C-001 | C — Conflict-of-interest | [P-C-001.md](./P-C-001.md) | [packages/patterns/src/category-c/](../../packages/patterns/src/category-c/) |
| P-C-002 | C                        | [P-C-002.md](./P-C-002.md) | category-c                                                                   |
| P-C-003 | C                        | [P-C-003.md](./P-C-003.md) | category-c                                                                   |
| P-C-004 | C                        | [P-C-004.md](./P-C-004.md) | category-c                                                                   |
| P-C-005 | C                        | [P-C-005.md](./P-C-005.md) | category-c                                                                   |
| P-C-006 | C                        | [P-C-006.md](./P-C-006.md) | category-c                                                                   |
| P-D-001 | D — Delivery             | [P-D-001.md](./P-D-001.md) | [packages/patterns/src/category-d/](../../packages/patterns/src/category-d/) |
| P-D-002 | D                        | [P-D-002.md](./P-D-002.md) | category-d                                                                   |
| P-D-003 | D                        | [P-D-003.md](./P-D-003.md) | category-d                                                                   |
| P-D-004 | D                        | [P-D-004.md](./P-D-004.md) | category-d                                                                   |
| P-D-005 | D                        | [P-D-005.md](./P-D-005.md) | category-d                                                                   |
| P-E-001 | E — Entity-network       | [P-E-001.md](./P-E-001.md) | [packages/patterns/src/category-e/](../../packages/patterns/src/category-e/) |
| P-E-002 | E                        | [P-E-002.md](./P-E-002.md) | category-e                                                                   |
| P-E-003 | E                        | [P-E-003.md](./P-E-003.md) | category-e                                                                   |
| P-E-004 | E                        | [P-E-004.md](./P-E-004.md) | category-e                                                                   |
| P-F-001 | F — Financial flows      | [P-F-001.md](./P-F-001.md) | [packages/patterns/src/category-f/](../../packages/patterns/src/category-f/) |
| P-F-002 | F                        | [P-F-002.md](./P-F-002.md) | category-f                                                                   |
| P-F-003 | F                        | [P-F-003.md](./P-F-003.md) | category-f                                                                   |
| P-F-004 | F                        | [P-F-004.md](./P-F-004.md) | category-f                                                                   |
| P-F-005 | F                        | [P-F-005.md](./P-F-005.md) | category-f                                                                   |
| P-G-001 | G — Document forensics   | [P-G-001.md](./P-G-001.md) | [packages/patterns/src/category-g/](../../packages/patterns/src/category-g/) |
| P-G-002 | G                        | [P-G-002.md](./P-G-002.md) | category-g                                                                   |
| P-G-003 | G                        | [P-G-003.md](./P-G-003.md) | category-g                                                                   |
| P-G-004 | G                        | [P-G-004.md](./P-G-004.md) | category-g                                                                   |
| P-H-001 | H — Public-finance       | [P-H-001.md](./P-H-001.md) | [packages/patterns/src/category-h/](../../packages/patterns/src/category-h/) |
| P-H-002 | H                        | [P-H-002.md](./P-H-002.md) | category-h                                                                   |
| P-H-003 | H                        | [P-H-003.md](./P-H-003.md) | category-h                                                                   |

**Total: 43 patterns** (verified by CI).
