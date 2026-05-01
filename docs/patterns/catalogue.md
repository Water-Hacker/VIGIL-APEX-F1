# Pattern Catalogue

> Auto-generated from `packages/patterns/src/` by
> [`scripts/generate-pattern-catalogue.ts`](../../scripts/generate-pattern-catalogue.ts).
>
> Edits to per-pattern descriptions, priors, or weights MUST be made
> in the `PatternDef` source file. Re-run the generator (or land the
> pattern PR; the phase-gate will regenerate in CI) to refresh this
> file. 43 patterns total.

---

## P-A-001 — Single-bidder award

> Marché à soumissionnaire unique

| Field | Value |
|---|---|
| Pattern ID | `P-A-001` |
| Category | A |
| Subject kinds | Tender |
| Default prior | 0.18 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-a/p-a-001-single-bidder.ts](../../packages/patterns/src/category-a/p-a-001-single-bidder.ts) |
| Fixture test | [packages/patterns/test/category-a/p-a-001-fixtures.test.ts](../../packages/patterns/test/category-a/p-a-001-fixtures.test.ts) |
| Calibration link | [./P-A-001.md#calibration-history](./P-A-001.md#calibration-history) |

### Description (FR)

Le marché a été attribué après réception d'une seule offre, ou en l'absence d'appel à concurrence formel.

### Description (EN)

Tender awarded after receiving exactly one bid, or without a formal competitive solicitation.

---

## P-A-002 — Split tender (slicing)

> Découpage de marché (saucissonnage)

| Field | Value |
|---|---|
| Pattern ID | `P-A-002` |
| Category | A |
| Subject kinds | Tender |
| Default prior | 0.18 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-a/p-a-002-split-tender.ts](../../packages/patterns/src/category-a/p-a-002-split-tender.ts) |
| Fixture test | [packages/patterns/test/category-a/p-a-002-split-tender-fixtures.test.ts](../../packages/patterns/test/category-a/p-a-002-split-tender-fixtures.test.ts) |
| Calibration link | [./P-A-002.md#calibration-history](./P-A-002.md#calibration-history) |

### Description (FR)

Plusieurs marchés au même fournisseur dans une fenêtre courte, chacun juste sous le seuil d'appel d'offres ouvert.

### Description (EN)

Multiple awards to the same supplier in a short window, each just below the open-tender threshold.

---

## P-A-003 — No-bid award without emergency justification

> Marché de gré-à-gré sans justification d'urgence

| Field | Value |
|---|---|
| Pattern ID | `P-A-003` |
| Category | A |
| Subject kinds | Tender |
| Default prior | 0.2 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-a/p-a-003-no-bid-emergency.ts](../../packages/patterns/src/category-a/p-a-003-no-bid-emergency.ts) |
| Fixture test | [packages/patterns/test/category-a/p-a-003-no-bid-emergency-fixtures.test.ts](../../packages/patterns/test/category-a/p-a-003-no-bid-emergency-fixtures.test.ts) |
| Calibration link | [./P-A-003.md#calibration-history](./P-A-003.md#calibration-history) |

### Description (FR)

Marché négocié ou gré-à-gré sans décret d'état d'urgence couvrant le secteur ou la période.

### Description (EN)

Sole-source or no-bid award not covered by an emergency decree applicable to the sector or period.

---

## P-A-004 — Late price-inflating amendment

> Avenant tardif inflationniste

| Field | Value |
|---|---|
| Pattern ID | `P-A-004` |
| Category | A |
| Subject kinds | Tender |
| Default prior | 0.18 |
| Default weight | 0.6 |
| Status | live |
| Source | [packages/patterns/src/category-a/p-a-004-late-amendment.ts](../../packages/patterns/src/category-a/p-a-004-late-amendment.ts) |
| Fixture test | [packages/patterns/test/category-a/p-a-004-late-amendment-fixtures.test.ts](../../packages/patterns/test/category-a/p-a-004-late-amendment-fixtures.test.ts) |
| Calibration link | [./P-A-004.md#calibration-history](./P-A-004.md#calibration-history) |

### Description (FR)

Un avenant signé en fin d'exécution augmente le montant initial d'au moins 25 %.

### Description (EN)

Amendment signed in the last third of the contract increases the awarded amount by ≥ 25 %.

---

## P-A-005 — Repeat no-bid awards

> Marchés répétitifs sans mise en concurrence

| Field | Value |
|---|---|
| Pattern ID | `P-A-005` |
| Category | A |
| Subject kinds | Tender |
| Default prior | 0.16 |
| Default weight | 0.65 |
| Status | live |
| Source | [packages/patterns/src/category-a/p-a-005-sole-source-gap.ts](../../packages/patterns/src/category-a/p-a-005-sole-source-gap.ts) |
| Fixture test | [packages/patterns/test/category-a/p-a-005-sole-source-gap-fixtures.test.ts](../../packages/patterns/test/category-a/p-a-005-sole-source-gap-fixtures.test.ts) |
| Calibration link | [./P-A-005.md#calibration-history](./P-A-005.md#calibration-history) |

### Description (FR)

Le même fournisseur remporte au moins trois marchés gré-à-gré du même donneur d'ordre en 12 mois.

### Description (EN)

Same supplier wins ≥ 3 no-bid awards from the same authority within 12 months.

---

## P-A-006 — Complementary-bidding distribution

> Distribution suspecte des offres

| Field | Value |
|---|---|
| Pattern ID | `P-A-006` |
| Category | A |
| Subject kinds | Tender |
| Default prior | 0.2 |
| Default weight | 0.65 |
| Status | live |
| Source | [packages/patterns/src/category-a/p-a-006-uneven-bid-spread.ts](../../packages/patterns/src/category-a/p-a-006-uneven-bid-spread.ts) |
| Fixture test | [packages/patterns/test/category-a/p-a-006-uneven-bid-spread-fixtures.test.ts](../../packages/patterns/test/category-a/p-a-006-uneven-bid-spread-fixtures.test.ts) |
| Calibration link | [./P-A-006.md#calibration-history](./P-A-006.md#calibration-history) |

### Description (FR)

Distribution typique d'une entente: gagnant 5-12 % sous le suivant, trois offres groupées, une aberrante.

### Description (EN)

Classic complementary-bidding shape: winner 5-12 % under the next, three clustered, one far above.

---

## P-A-007 — Narrow specification favouring a single supplier

> Spécification rédigée pour un fournisseur

| Field | Value |
|---|---|
| Pattern ID | `P-A-007` |
| Category | A |
| Subject kinds | Tender |
| Default prior | 0.18 |
| Default weight | 0.6 |
| Status | live |
| Source | [packages/patterns/src/category-a/p-a-007-narrow-spec.ts](../../packages/patterns/src/category-a/p-a-007-narrow-spec.ts) |
| Fixture test | [packages/patterns/test/category-a/p-a-007-narrow-spec-fixtures.test.ts](../../packages/patterns/test/category-a/p-a-007-narrow-spec-fixtures.test.ts) |
| Calibration link | [./P-A-007.md#calibration-history](./P-A-007.md#calibration-history) |

### Description (FR)

Termes propriétaires ou références exclusives dans le cahier des charges, peu de soumissionnaires retenus.

### Description (EN)

Proprietary terms or exclusive references in the specification, very few bids accepted.

---

## P-A-008 — Suppressed-protest pattern

> Schéma de plaintes étouffées

| Field | Value |
|---|---|
| Pattern ID | `P-A-008` |
| Category | A |
| Subject kinds | Tender |
| Default prior | 0.16 |
| Default weight | 0.55 |
| Status | live |
| Source | [packages/patterns/src/category-a/p-a-008-bid-protest-pattern.ts](../../packages/patterns/src/category-a/p-a-008-bid-protest-pattern.ts) |
| Fixture test | [packages/patterns/test/category-a/p-a-008-bid-protest-pattern-fixtures.test.ts](../../packages/patterns/test/category-a/p-a-008-bid-protest-pattern-fixtures.test.ts) |
| Calibration link | [./P-A-008.md#calibration-history](./P-A-008.md#calibration-history) |

### Description (FR)

Mêmes plaignants, mêmes attributaires, plaintes systématiquement rejetées sans examen substantiel.

### Description (EN)

Same complainants, same awardees, complaints rejected without substantive review.

---

## P-A-009 — Debarment bypass

> Contournement de débarrement

| Field | Value |
|---|---|
| Pattern ID | `P-A-009` |
| Category | A |
| Subject kinds | Tender |
| Default prior | 0.55 |
| Default weight | 0.95 |
| Status | live |
| Source | [packages/patterns/src/category-a/p-a-009-debarment-bypass.ts](../../packages/patterns/src/category-a/p-a-009-debarment-bypass.ts) |
| Fixture test | [packages/patterns/test/category-a/p-a-009-debarment-bypass-fixtures.test.ts](../../packages/patterns/test/category-a/p-a-009-debarment-bypass-fixtures.test.ts) |
| Calibration link | [./P-A-009.md#calibration-history](./P-A-009.md#calibration-history) |

### Description (FR)

Le fournisseur ou un de ses dirigeants est inscrit sur une liste de débarrement; le marché est attribué pendant la période d'inéligibilité.

### Description (EN)

Supplier or one of its directors appears on a debarment list; the contract is awarded during the ineligibility period.

---

## P-B-001 — Shell-company indicator

> Indicateur de société écran

| Field | Value |
|---|---|
| Pattern ID | `P-B-001` |
| Category | B |
| Subject kinds | Company |
| Default prior | 0.22 |
| Default weight | 0.85 |
| Status | live |
| Source | [packages/patterns/src/category-b/p-b-001-shell-company.ts](../../packages/patterns/src/category-b/p-b-001-shell-company.ts) |
| Fixture test | [packages/patterns/test/category-b/p-b-001-shell-company-fixtures.test.ts](../../packages/patterns/test/category-b/p-b-001-shell-company-fixtures.test.ts) |
| Calibration link | [./P-B-001.md#calibration-history](./P-B-001.md#calibration-history) |

### Description (FR)

Société constituée peu avant l’attribution du marché, sans antécédents administratifs ou financiers significatifs.

### Description (EN)

Company incorporated shortly before the contract award with thin administrative or financial history.

---

## P-B-002 — Nominee director

> Dirigeant fictif (nominee)

| Field | Value |
|---|---|
| Pattern ID | `P-B-002` |
| Category | B |
| Subject kinds | Person, Company |
| Default prior | 0.22 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-b/p-b-002-nominee-director.ts](../../packages/patterns/src/category-b/p-b-002-nominee-director.ts) |
| Fixture test | [packages/patterns/test/category-b/p-b-002-nominee-director-fixtures.test.ts](../../packages/patterns/test/category-b/p-b-002-nominee-director-fixtures.test.ts) |
| Calibration link | [./P-B-002.md#calibration-history](./P-B-002.md#calibration-history) |

### Description (FR)

Personne enregistrée comme dirigeante d'au moins 10 sociétés sans lien apparent, dont plusieurs attributaires.

### Description (EN)

Person on record as director of ≥ 10 unrelated companies, several of which are public-contract awardees.

---

## P-B-003 — Opaque-jurisdiction shopping

> Optimisation de juridiction (paradis opaque)

| Field | Value |
|---|---|
| Pattern ID | `P-B-003` |
| Category | B |
| Subject kinds | Company |
| Default prior | 0.3 |
| Default weight | 0.75 |
| Status | live |
| Source | [packages/patterns/src/category-b/p-b-003-jurisdiction-shopping.ts](../../packages/patterns/src/category-b/p-b-003-jurisdiction-shopping.ts) |
| Fixture test | [packages/patterns/test/category-b/p-b-003-jurisdiction-shopping-fixtures.test.ts](../../packages/patterns/test/category-b/p-b-003-jurisdiction-shopping-fixtures.test.ts) |
| Calibration link | [./P-B-003.md#calibration-history](./P-B-003.md#calibration-history) |

### Description (FR)

Soumissionnaire constitué dans une juridiction à divulgation faible (BVI, Seychelles, Maurice, Belize…) sans présence camerounaise.

### Description (EN)

Bidder incorporated in a low-disclosure jurisdiction (BVI, Seychelles, Mauritius, Belize…) with no Cameroonian registry footprint.

---

## P-B-004 — Sub-30-day pre-tender incorporation

> Constitution éclair avant appel d'offres

| Field | Value |
|---|---|
| Pattern ID | `P-B-004` |
| Category | B |
| Subject kinds | Company, Tender |
| Default prior | 0.4 |
| Default weight | 0.85 |
| Status | live |
| Source | [packages/patterns/src/category-b/p-b-004-rapid-incorporation.ts](../../packages/patterns/src/category-b/p-b-004-rapid-incorporation.ts) |
| Fixture test | [packages/patterns/test/category-b/p-b-004-rapid-incorporation-fixtures.test.ts](../../packages/patterns/test/category-b/p-b-004-rapid-incorporation-fixtures.test.ts) |
| Calibration link | [./P-B-004.md#calibration-history](./P-B-004.md#calibration-history) |

### Description (FR)

Société constituée moins de 30 jours avant la publication du marché qu'elle a remporté.

### Description (EN)

Company incorporated < 30 days before the tender publication that it then won.

---

## P-B-005 — Co-incorporated cluster

> Constitution simultanée en grappe

| Field | Value |
|---|---|
| Pattern ID | `P-B-005` |
| Category | B |
| Subject kinds | Company |
| Default prior | 0.2 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-b/p-b-005-co-incorporated-cluster.ts](../../packages/patterns/src/category-b/p-b-005-co-incorporated-cluster.ts) |
| Fixture test | [packages/patterns/test/category-b/p-b-005-co-incorporated-cluster-fixtures.test.ts](../../packages/patterns/test/category-b/p-b-005-co-incorporated-cluster-fixtures.test.ts) |
| Calibration link | [./P-B-005.md#calibration-history](./P-B-005.md#calibration-history) |

### Description (FR)

Plusieurs sociétés constituées à la même date ou à la même adresse dans une fenêtre courte.

### Description (EN)

Multiple companies incorporated at the same date or address within a short window.

---

## P-B-006 — UBO mismatch

> Incohérence sur le bénéficiaire effectif

| Field | Value |
|---|---|
| Pattern ID | `P-B-006` |
| Category | B |
| Subject kinds | Company |
| Default prior | 0.25 |
| Default weight | 0.75 |
| Status | live |
| Source | [packages/patterns/src/category-b/p-b-006-ubo-mismatch.ts](../../packages/patterns/src/category-b/p-b-006-ubo-mismatch.ts) |
| Fixture test | [packages/patterns/test/category-b/p-b-006-ubo-mismatch-fixtures.test.ts](../../packages/patterns/test/category-b/p-b-006-ubo-mismatch-fixtures.test.ts) |
| Calibration link | [./P-B-006.md#calibration-history](./P-B-006.md#calibration-history) |

### Description (FR)

Le bénéficiaire effectif déclaré dans la procédure de marché diffère du registre commercial.

### Description (EN)

Beneficial owner declared in the procurement filing differs from the commercial registry.

---

## P-B-007 — Politically-exposed-person linkage

> Lien avec une personne politiquement exposée

| Field | Value |
|---|---|
| Pattern ID | `P-B-007` |
| Category | B |
| Subject kinds | Company, Tender |
| Default prior | 0.18 |
| Default weight | 0.55 |
| Status | live |
| Source | [packages/patterns/src/category-b/p-b-007-pep-link.ts](../../packages/patterns/src/category-b/p-b-007-pep-link.ts) |
| Fixture test | [packages/patterns/test/category-b/p-b-007-pep-link-fixtures.test.ts](../../packages/patterns/test/category-b/p-b-007-pep-link-fixtures.test.ts) |
| Calibration link | [./P-B-007.md#calibration-history](./P-B-007.md#calibration-history) |

### Description (FR)

Un dirigeant, actionnaire ou proche du soumissionnaire est inscrit comme personne politiquement exposée (PPE).

### Description (EN)

A director, shareholder, or close associate of the bidder is recorded as a Politically-Exposed Person.

---

## P-C-001 — Price materially above benchmark

> Prix sensiblement supérieur au repère

| Field | Value |
|---|---|
| Pattern ID | `P-C-001` |
| Category | C |
| Subject kinds | Tender |
| Default prior | 0.12 |
| Default weight | 0.6 |
| Status | live |
| Source | [packages/patterns/src/category-c/p-c-001-price-above-benchmark.ts](../../packages/patterns/src/category-c/p-c-001-price-above-benchmark.ts) |
| Fixture test | [packages/patterns/test/category-c/p-c-001-price-above-benchmark-fixtures.test.ts](../../packages/patterns/test/category-c/p-c-001-price-above-benchmark-fixtures.test.ts) |
| Calibration link | [./P-C-001.md#calibration-history](./P-C-001.md#calibration-history) |

### Description (FR)

Le montant attribué dépasse de plus de 30 % la médiane mobile des marchés comparables.

### Description (EN)

Awarded amount exceeds the moving-median benchmark of comparable tenders by ≥ 30 %.

---

## P-C-002 — Unit-price anomaly on a line item

> Prix unitaire aberrant sur une ligne

| Field | Value |
|---|---|
| Pattern ID | `P-C-002` |
| Category | C |
| Subject kinds | Tender |
| Default prior | 0.16 |
| Default weight | 0.6 |
| Status | live |
| Source | [packages/patterns/src/category-c/p-c-002-unit-price-anomaly.ts](../../packages/patterns/src/category-c/p-c-002-unit-price-anomaly.ts) |
| Fixture test | [packages/patterns/test/category-c/p-c-002-unit-price-anomaly-fixtures.test.ts](../../packages/patterns/test/category-c/p-c-002-unit-price-anomaly-fixtures.test.ts) |
| Calibration link | [./P-C-002.md#calibration-history](./P-C-002.md#calibration-history) |

### Description (FR)

Au moins une ligne du marché présente un prix unitaire >= 1,5× la médiane sectorielle.

### Description (EN)

At least one line item carries a unit price ≥ 1.5× the sectoral median.

---

## P-C-003 — Invoiced quantity exceeds specified quantity

> Quantités facturées supérieures à la spécification

| Field | Value |
|---|---|
| Pattern ID | `P-C-003` |
| Category | C |
| Subject kinds | Tender |
| Default prior | 0.15 |
| Default weight | 0.6 |
| Status | live |
| Source | [packages/patterns/src/category-c/p-c-003-quantity-mismatch.ts](../../packages/patterns/src/category-c/p-c-003-quantity-mismatch.ts) |
| Fixture test | [packages/patterns/test/category-c/p-c-003-quantity-mismatch-fixtures.test.ts](../../packages/patterns/test/category-c/p-c-003-quantity-mismatch-fixtures.test.ts) |
| Calibration link | [./P-C-003.md#calibration-history](./P-C-003.md#calibration-history) |

### Description (FR)

Au moins une ligne facturée dépasse la quantité prévue de plus de 30 %, sans avenant correspondant.

### Description (EN)

At least one invoiced line exceeds the specified quantity by > 30 % without a recorded amendment.

---

## P-C-004 — Escalation above official CPI

> Indexation supérieure à l'inflation officielle

| Field | Value |
|---|---|
| Pattern ID | `P-C-004` |
| Category | C |
| Subject kinds | Tender |
| Default prior | 0.14 |
| Default weight | 0.55 |
| Status | live |
| Source | [packages/patterns/src/category-c/p-c-004-inflation-divergence.ts](../../packages/patterns/src/category-c/p-c-004-inflation-divergence.ts) |
| Fixture test | [packages/patterns/test/category-c/p-c-004-inflation-divergence-fixtures.test.ts](../../packages/patterns/test/category-c/p-c-004-inflation-divergence-fixtures.test.ts) |
| Calibration link | [./P-C-004.md#calibration-history](./P-C-004.md#calibration-history) |

### Description (FR)

L'indexation appliquée au marché dépasse l'inflation officielle (BEAC) sur la période, sans clause publiée.

### Description (EN)

Escalation applied to the contract exceeds official BEAC CPI over the period.

---

## P-C-005 — Supplier-favouring currency arbitrage

> Arbitrage de change en faveur du fournisseur

| Field | Value |
|---|---|
| Pattern ID | `P-C-005` |
| Category | C |
| Subject kinds | Tender |
| Default prior | 0.1 |
| Default weight | 0.5 |
| Status | live |
| Source | [packages/patterns/src/category-c/p-c-005-currency-arbitrage.ts](../../packages/patterns/src/category-c/p-c-005-currency-arbitrage.ts) |
| Fixture test | [packages/patterns/test/category-c/p-c-005-currency-arbitrage-fixtures.test.ts](../../packages/patterns/test/category-c/p-c-005-currency-arbitrage-fixtures.test.ts) |
| Calibration link | [./P-C-005.md#calibration-history](./P-C-005.md#calibration-history) |

### Description (FR)

Conversion XAF/EUR ou XAF/USD appliquée à la facturation différant de plus de 4 % du fixing BEAC du jour.

### Description (EN)

XAF/EUR or XAF/USD invoicing rate diverges from the BEAC fixing of the payment date by ≥ 4 %.

---

## P-C-006 — Premature escalation-clause activation

> Activation abusive de clause de révision

| Field | Value |
|---|---|
| Pattern ID | `P-C-006` |
| Category | C |
| Subject kinds | Tender |
| Default prior | 0.16 |
| Default weight | 0.55 |
| Status | live |
| Source | [packages/patterns/src/category-c/p-c-006-escalation-clause-abuse.ts](../../packages/patterns/src/category-c/p-c-006-escalation-clause-abuse.ts) |
| Fixture test | [packages/patterns/test/category-c/p-c-006-escalation-clause-abuse-fixtures.test.ts](../../packages/patterns/test/category-c/p-c-006-escalation-clause-abuse-fixtures.test.ts) |
| Calibration link | [./P-C-006.md#calibration-history](./P-C-006.md#calibration-history) |

### Description (FR)

La clause de révision a été activée avant que le seuil contractuel ne soit atteint.

### Description (EN)

Escalation clause activated before the contractual trigger threshold was met.

---

## P-D-001 — Ghost project — unverified on the ground

> Projet fantôme — non vérifié au sol

| Field | Value |
|---|---|
| Pattern ID | `P-D-001` |
| Category | D |
| Subject kinds | Project |
| Default prior | 0.45 |
| Default weight | 0.95 |
| Status | live |
| Source | [packages/patterns/src/category-d/p-d-001-ghost-project.ts](../../packages/patterns/src/category-d/p-d-001-ghost-project.ts) |
| Fixture test | [packages/patterns/test/category-d/p-d-001-ghost-project-fixtures.test.ts](../../packages/patterns/test/category-d/p-d-001-ghost-project-fixtures.test.ts) |
| Calibration link | [./P-D-001.md#calibration-history](./P-D-001.md#calibration-history) |

### Description (FR)

Aucune activité de construction détectée par imagerie satellitaire dans la fenêtre contractuelle.

### Description (EN)

No construction activity detected by satellite imagery during the contractual window.

---

## P-D-002 — Project signed off as complete despite visible incompleteness

> Réception prononcée alors que l'ouvrage est incomplet

| Field | Value |
|---|---|
| Pattern ID | `P-D-002` |
| Category | D |
| Subject kinds | Project |
| Default prior | 0.3 |
| Default weight | 0.85 |
| Status | live |
| Source | [packages/patterns/src/category-d/p-d-002-incomplete-construction.ts](../../packages/patterns/src/category-d/p-d-002-incomplete-construction.ts) |
| Fixture test | [packages/patterns/test/category-d/p-d-002-incomplete-construction-fixtures.test.ts](../../packages/patterns/test/category-d/p-d-002-incomplete-construction-fixtures.test.ts) |
| Calibration link | [./P-D-002.md#calibration-history](./P-D-002.md#calibration-history) |

### Description (FR)

Procès-verbal de réception alors que l'imagerie satellite révèle une construction partielle.

### Description (EN)

Completion certificate signed while satellite imagery shows the work is partial.

---

## P-D-003 — Site mismatch (work at different coordinates)

> Site d'exécution incohérent

| Field | Value |
|---|---|
| Pattern ID | `P-D-003` |
| Category | D |
| Subject kinds | Project |
| Default prior | 0.2 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-d/p-d-003-site-mismatch.ts](../../packages/patterns/src/category-d/p-d-003-site-mismatch.ts) |
| Fixture test | [packages/patterns/test/category-d/p-d-003-site-mismatch-fixtures.test.ts](../../packages/patterns/test/category-d/p-d-003-site-mismatch-fixtures.test.ts) |
| Calibration link | [./P-D-003.md#calibration-history](./P-D-003.md#calibration-history) |

### Description (FR)

Activité satellitaire à plus de 500 m des coordonnées GPS déclarées dans le marché.

### Description (EN)

Satellite activity ≥ 500 m from the GPS coordinates declared in the contract.

---

## P-D-004 — Uncorrected quality deficit

> Déficit de qualité non corrigé

| Field | Value |
|---|---|
| Pattern ID | `P-D-004` |
| Category | D |
| Subject kinds | Project |
| Default prior | 0.2 |
| Default weight | 0.65 |
| Status | live |
| Source | [packages/patterns/src/category-d/p-d-004-quality-deficit.ts](../../packages/patterns/src/category-d/p-d-004-quality-deficit.ts) |
| Fixture test | [packages/patterns/test/category-d/p-d-004-quality-deficit-fixtures.test.ts](../../packages/patterns/test/category-d/p-d-004-quality-deficit-fixtures.test.ts) |
| Calibration link | [./P-D-004.md#calibration-history](./P-D-004.md#calibration-history) |

### Description (FR)

Une observation de la Cour des Comptes ou d'un audit technique signale un défaut, sans avenant correctif.

### Description (EN)

Cour des Comptes or technical audit flags a quality deficit; no remediation amendment exists.

---

## P-D-005 — Fabricated progress reports

> Rapports d'avancement fabriqués

| Field | Value |
|---|---|
| Pattern ID | `P-D-005` |
| Category | D |
| Subject kinds | Project |
| Default prior | 0.3 |
| Default weight | 0.85 |
| Status | live |
| Source | [packages/patterns/src/category-d/p-d-005-progress-fabrication.ts](../../packages/patterns/src/category-d/p-d-005-progress-fabrication.ts) |
| Fixture test | [packages/patterns/test/category-d/p-d-005-progress-fabrication-fixtures.test.ts](../../packages/patterns/test/category-d/p-d-005-progress-fabrication-fixtures.test.ts) |
| Calibration link | [./P-D-005.md#calibration-history](./P-D-005.md#calibration-history) |

### Description (FR)

Les rapports périodiques affichent une progression alors que l'imagerie satellite ne montre aucun changement.

### Description (EN)

Progress reports show steady advancement while satellite imagery shows no change in activity.

---

## P-E-001 — Direct sanctioned-entity exposure

> Exposition directe à une entité sanctionnée

| Field | Value |
|---|---|
| Pattern ID | `P-E-001` |
| Category | E |
| Subject kinds | Tender, Company |
| Default prior | 0.55 |
| Default weight | 0.95 |
| Status | live |
| Source | [packages/patterns/src/category-e/p-e-001-sanctioned-direct.ts](../../packages/patterns/src/category-e/p-e-001-sanctioned-direct.ts) |
| Fixture test | [packages/patterns/test/category-e/p-e-001-sanctioned-direct-fixtures.test.ts](../../packages/patterns/test/category-e/p-e-001-sanctioned-direct-fixtures.test.ts) |
| Calibration link | [./P-E-001.md#calibration-history](./P-E-001.md#calibration-history) |

### Description (FR)

Le fournisseur ou un actionnaire direct figure sur une liste de sanctions internationales.

### Description (EN)

Supplier or direct shareholder appears on an international sanctions roster.

---

## P-E-002 — Indirect sanctioned-entity exposure

> Exposition indirecte à une entité sanctionnée

| Field | Value |
|---|---|
| Pattern ID | `P-E-002` |
| Category | E |
| Subject kinds | Tender, Company |
| Default prior | 0.3 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-e/p-e-002-sanctioned-related.ts](../../packages/patterns/src/category-e/p-e-002-sanctioned-related.ts) |
| Fixture test | [packages/patterns/test/category-e/p-e-002-sanctioned-related-fixtures.test.ts](../../packages/patterns/test/category-e/p-e-002-sanctioned-related-fixtures.test.ts) |
| Calibration link | [./P-E-002.md#calibration-history](./P-E-002.md#calibration-history) |

### Description (FR)

Une partie liée du soumissionnaire (filiale, société sœur, actionnaire commun) figure sur une liste de sanctions.

### Description (EN)

A related party of the bidder (subsidiary, sibling, common shareholder) is on a sanctions list.

---

## P-E-003 — Payment routed via a sanctioned jurisdiction

> Paiement vers une juridiction sanctionnée

| Field | Value |
|---|---|
| Pattern ID | `P-E-003` |
| Category | E |
| Subject kinds | Tender |
| Default prior | 0.55 |
| Default weight | 0.95 |
| Status | live |
| Source | [packages/patterns/src/category-e/p-e-003-sanctioned-jurisdiction-payment.ts](../../packages/patterns/src/category-e/p-e-003-sanctioned-jurisdiction-payment.ts) |
| Fixture test | [packages/patterns/test/category-e/p-e-003-sanctioned-jurisdiction-payment-fixtures.test.ts](../../packages/patterns/test/category-e/p-e-003-sanctioned-jurisdiction-payment-fixtures.test.ts) |
| Calibration link | [./P-E-003.md#calibration-history](./P-E-003.md#calibration-history) |

### Description (FR)

Compte bancaire de paiement situé dans une juridiction sous sanctions internationales (Iran, RPDC, Syrie…).

### Description (EN)

Beneficiary bank account is located in a sanctioned jurisdiction (Iran, DPRK, Syria, …).

---

## P-E-004 — PEP-controlled sanctioned vehicle transaction

> Transaction via un véhicule contrôlé par PPE et sanctionné

| Field | Value |
|---|---|
| Pattern ID | `P-E-004` |
| Category | E |
| Subject kinds | Tender, Company |
| Default prior | 0.5 |
| Default weight | 0.95 |
| Status | live |
| Source | [packages/patterns/src/category-e/p-e-004-transaction-pep-sanctioned.ts](../../packages/patterns/src/category-e/p-e-004-transaction-pep-sanctioned.ts) |
| Fixture test | [packages/patterns/test/category-e/p-e-004-transaction-pep-sanctioned-fixtures.test.ts](../../packages/patterns/test/category-e/p-e-004-transaction-pep-sanctioned-fixtures.test.ts) |
| Calibration link | [./P-E-004.md#calibration-history](./P-E-004.md#calibration-history) |

### Description (FR)

Le soumissionnaire est contrôlé par une PPE et une partie liée figure sur une liste de sanctions.

### Description (EN)

Bidder is PEP-controlled and a related party is sanctioned — combined signal.

---

## P-F-001 — Round-trip payment back to awarding authority

> Retour de fonds vers l'autorité contractante

| Field | Value |
|---|---|
| Pattern ID | `P-F-001` |
| Category | F |
| Subject kinds | Tender, Payment |
| Default prior | 0.4 |
| Default weight | 0.9 |
| Status | live |
| Source | [packages/patterns/src/category-f/p-f-001-round-trip-payment.ts](../../packages/patterns/src/category-f/p-f-001-round-trip-payment.ts) |
| Fixture test | [packages/patterns/test/category-f/p-f-001-round-trip-payment-fixtures.test.ts](../../packages/patterns/test/category-f/p-f-001-round-trip-payment-fixtures.test.ts) |
| Calibration link | [./P-F-001.md#calibration-history](./P-F-001.md#calibration-history) |

### Description (FR)

Les fonds versés au fournisseur reviennent — directement ou en 1-2 sauts — sur un compte lié à l'ordonnateur.

### Description (EN)

Funds paid to the supplier return — directly or in 1-2 hops — to an account linked to the awarding authority.

---

## P-F-002 — Shared-director ring

> Anneau de dirigeants partagés

| Field | Value |
|---|---|
| Pattern ID | `P-F-002` |
| Category | F |
| Subject kinds | Tender, Company |
| Default prior | 0.3 |
| Default weight | 0.85 |
| Status | live |
| Source | [packages/patterns/src/category-f/p-f-002-director-ring.ts](../../packages/patterns/src/category-f/p-f-002-director-ring.ts) |
| Fixture test | [packages/patterns/test/category-f/p-f-002-director-ring-fixtures.test.ts](../../packages/patterns/test/category-f/p-f-002-director-ring-fixtures.test.ts) |
| Calibration link | [./P-F-002.md#calibration-history](./P-F-002.md#calibration-history) |

### Description (FR)

Plusieurs sociétés concurrentes sur le même marché partagent au moins deux dirigeants — schéma classique d’entente.

### Description (EN)

Multiple competing bidders share ≥ 2 directors — canonical bid-rigging signal.

---

## P-F-003 — Supplier-circular flow (A→B→C→A)

> Flux circulaire entre fournisseurs

| Field | Value |
|---|---|
| Pattern ID | `P-F-003` |
| Category | F |
| Subject kinds | Company |
| Default prior | 0.3 |
| Default weight | 0.8 |
| Status | live |
| Source | [packages/patterns/src/category-f/p-f-003-supplier-circular-flow.ts](../../packages/patterns/src/category-f/p-f-003-supplier-circular-flow.ts) |
| Fixture test | [packages/patterns/test/category-f/p-f-003-supplier-circular-flow-fixtures.test.ts](../../packages/patterns/test/category-f/p-f-003-supplier-circular-flow-fixtures.test.ts) |
| Calibration link | [./P-F-003.md#calibration-history](./P-F-003.md#calibration-history) |

### Description (FR)

Cycle d'au moins trois fournisseurs où chaque facture est un service générique au suivant.

### Description (EN)

Cycle of ≥ 3 suppliers, each invoicing a generic service to the next, returning to A.

---

## P-F-004 — Hub-and-spoke procurement vehicle

> Schéma en étoile (un seul donneur d'ordre)

| Field | Value |
|---|---|
| Pattern ID | `P-F-004` |
| Category | F |
| Subject kinds | Company |
| Default prior | 0.2 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-f/p-f-004-hub-and-spoke.ts](../../packages/patterns/src/category-f/p-f-004-hub-and-spoke.ts) |
| Fixture test | [packages/patterns/test/category-f/p-f-004-hub-and-spoke-fixtures.test.ts](../../packages/patterns/test/category-f/p-f-004-hub-and-spoke-fixtures.test.ts) |
| Calibration link | [./P-F-004.md#calibration-history](./P-F-004.md#calibration-history) |

### Description (FR)

Au moins 70 % des marchés du fournisseur proviennent d'une même autorité contractante.

### Description (EN)

≥ 70 % of the supplier's public contracts come from a single authority.

---

## P-F-005 — Dense bidder network

> Réseau dense de soumissionnaires

| Field | Value |
|---|---|
| Pattern ID | `P-F-005` |
| Category | F |
| Subject kinds | Tender |
| Default prior | 0.22 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-f/p-f-005-dense-bidder-network.ts](../../packages/patterns/src/category-f/p-f-005-dense-bidder-network.ts) |
| Fixture test | [packages/patterns/test/category-f/p-f-005-dense-bidder-network-fixtures.test.ts](../../packages/patterns/test/category-f/p-f-005-dense-bidder-network-fixtures.test.ts) |
| Calibration link | [./P-F-005.md#calibration-history](./P-F-005.md#calibration-history) |

### Description (FR)

Les soumissionnaires d'un même appel d'offres forment un sous-graphe dense (parts d'administrateurs, adresses, actionnaires).

### Description (EN)

Bidders for the same tender form a dense subgraph (shared directors / addresses / shareholders).

---

## P-G-001 — Backdated document

> Document antidaté

| Field | Value |
|---|---|
| Pattern ID | `P-G-001` |
| Category | G |
| Subject kinds | Tender |
| Default prior | 0.35 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-g/p-g-001-backdated-document.ts](../../packages/patterns/src/category-g/p-g-001-backdated-document.ts) |
| Fixture test | [packages/patterns/test/category-g/p-g-001-backdated-document-fixtures.test.ts](../../packages/patterns/test/category-g/p-g-001-backdated-document-fixtures.test.ts) |
| Calibration link | [./P-G-001.md#calibration-history](./P-G-001.md#calibration-history) |

### Description (FR)

La date de création des métadonnées est postérieure à la date effective déclarée par le document.

### Description (EN)

Document metadata creation date is after the document's stated effective date.

---

## P-G-002 — Signature image diverges from reference

> Signature non conforme à la référence

| Field | Value |
|---|---|
| Pattern ID | `P-G-002` |
| Category | G |
| Subject kinds | Tender |
| Default prior | 0.3 |
| Default weight | 0.7 |
| Status | live |
| Source | [packages/patterns/src/category-g/p-g-002-signature-mismatch.ts](../../packages/patterns/src/category-g/p-g-002-signature-mismatch.ts) |
| Fixture test | [packages/patterns/test/category-g/p-g-002-signature-mismatch-fixtures.test.ts](../../packages/patterns/test/category-g/p-g-002-signature-mismatch-fixtures.test.ts) |
| Calibration link | [./P-G-002.md#calibration-history](./P-G-002.md#calibration-history) |

### Description (FR)

L'image de la signature sur un acte diffère matériellement de la signature de référence du signataire déclaré.

### Description (EN)

Signature image on a document materially diverges from the named officer's reference signature.

---

## P-G-003 — Document metadata anomaly

> Anomalie de métadonnées documentaires

| Field | Value |
|---|---|
| Pattern ID | `P-G-003` |
| Category | G |
| Subject kinds | Tender |
| Default prior | 0.18 |
| Default weight | 0.55 |
| Status | live |
| Source | [packages/patterns/src/category-g/p-g-003-metadata-anomaly.ts](../../packages/patterns/src/category-g/p-g-003-metadata-anomaly.ts) |
| Fixture test | [packages/patterns/test/category-g/p-g-003-metadata-anomaly-fixtures.test.ts](../../packages/patterns/test/category-g/p-g-003-metadata-anomaly-fixtures.test.ts) |
| Calibration link | [./P-G-003.md#calibration-history](./P-G-003.md#calibration-history) |

### Description (FR)

Les métadonnées du document (auteur, logiciel, date de modification) sont incohérentes avec son origine déclarée.

### Description (EN)

Document metadata (author, software, modification date) are inconsistent with its stated origin.

---

## P-G-004 — Typography anomaly on a critical field

> Incohérence typographique sur un champ critique

| Field | Value |
|---|---|
| Pattern ID | `P-G-004` |
| Category | G |
| Subject kinds | Tender |
| Default prior | 0.25 |
| Default weight | 0.6 |
| Status | live |
| Source | [packages/patterns/src/category-g/p-g-004-font-anomaly.ts](../../packages/patterns/src/category-g/p-g-004-font-anomaly.ts) |
| Fixture test | [packages/patterns/test/category-g/p-g-004-font-anomaly-fixtures.test.ts](../../packages/patterns/test/category-g/p-g-004-font-anomaly-fixtures.test.ts) |
| Calibration link | [./P-G-004.md#calibration-history](./P-G-004.md#calibration-history) |

### Description (FR)

Police ou interlettrage différent sur un champ critique (montant, nom du fournisseur, signataire).

### Description (EN)

Different font or letter-spacing on a critical field (amount, supplier name, signing officer).

---

## P-H-001 — Award dated before tender close

> Attribution antérieure à la clôture de l'appel d'offres

| Field | Value |
|---|---|
| Pattern ID | `P-H-001` |
| Category | H |
| Subject kinds | Tender |
| Default prior | 0.2 |
| Default weight | 0.6 |
| Status | live |
| Source | [packages/patterns/src/category-h/p-h-001-award-before-tender-close.ts](../../packages/patterns/src/category-h/p-h-001-award-before-tender-close.ts) |
| Fixture test | [packages/patterns/test/category-h/p-h-001-award-before-tender-close-fixtures.test.ts](../../packages/patterns/test/category-h/p-h-001-award-before-tender-close-fixtures.test.ts) |
| Calibration link | [./P-H-001.md#calibration-history](./P-H-001.md#calibration-history) |

### Description (FR)

La date de publication de l’attribution précède la date officielle de clôture du marché.

### Description (EN)

Award publication is dated before the tender's official close date.

---

## P-H-002 — Disbursement dated before authorising amendment

> Décaissement antérieur à son avenant

| Field | Value |
|---|---|
| Pattern ID | `P-H-002` |
| Category | H |
| Subject kinds | Tender |
| Default prior | 0.3 |
| Default weight | 0.75 |
| Status | live |
| Source | [packages/patterns/src/category-h/p-h-002-amendment-out-of-sequence.ts](../../packages/patterns/src/category-h/p-h-002-amendment-out-of-sequence.ts) |
| Fixture test | [packages/patterns/test/category-h/p-h-002-amendment-out-of-sequence-fixtures.test.ts](../../packages/patterns/test/category-h/p-h-002-amendment-out-of-sequence-fixtures.test.ts) |
| Calibration link | [./P-H-002.md#calibration-history](./P-H-002.md#calibration-history) |

### Description (FR)

Le mandat de paiement est daté avant l'avenant qui en constitue le fondement légal.

### Description (EN)

Treasury disbursement is dated before the amendment that legally authorised it.

---

## P-H-003 — Holiday-eve publication burst

> Publication concentrée à l'approche d'un jour férié

| Field | Value |
|---|---|
| Pattern ID | `P-H-003` |
| Category | H |
| Subject kinds | Tender |
| Default prior | 0.15 |
| Default weight | 0.5 |
| Status | live |
| Source | [packages/patterns/src/category-h/p-h-003-holiday-publication-burst.ts](../../packages/patterns/src/category-h/p-h-003-holiday-publication-burst.ts) |
| Fixture test | [packages/patterns/test/category-h/p-h-003-holiday-publication-burst-fixtures.test.ts](../../packages/patterns/test/category-h/p-h-003-holiday-publication-burst-fixtures.test.ts) |
| Calibration link | [./P-H-003.md#calibration-history](./P-H-003.md#calibration-history) |

### Description (FR)

Publications anormalement nombreuses la veille d'un jour férié ou en période creuse (fin décembre).

### Description (EN)

Anomalously high publication volume on dates designed to evade public scrutiny.

---
