# DOSSIER VIGIL APEX — VA-2026-0001

> **AVIS** — Dossier synthétique, généré à des fins de démonstration de la
> revue UNDP. Aucune entité, aucun montant, aucun fait ne correspond à des
> données réelles. Les noms, références RCCM/NIU et adresses sont fabriqués.

**Référence :** `VA-2026-0001`
**Classification :** RESTREINT — destinataire institutionnel uniquement
**Langue :** Français (variante anglaise jointe : `VA-2026-0001-en.pdf`)
**Date d'émission :** 17 mai 2026
**Destinataire :** Commission Nationale Anti-Corruption (CONAC)
**Vérification publique :** https://verify.vigilapex.cm/verify/VA-2026-0001
**Ancrage horodaté public :** https://verify.vigilapex.cm/ledger

---

## Résumé

Un schéma de fractionnement de marchés publics impliquant trois entités
juridiquement distinctes mais effectivement liées a été détecté sur la
période octobre 2024 – février 2026 dans la région du Centre. Le marché
fractionné totaliserait **287 450 000 XAF**, structuré en cinq tranches
inférieures au seuil de 90 000 000 XAF déclenchant l'appel d'offres ouvert
(art. 22 du Code des marchés publics 2018).

Les trois entités attributaires (SARL Synthétique A, SAS Synthétique B,
SARL Synthétique C) partagent un bénéficiaire effectif commun et une
adresse postale identique selon les registres consultés.

---

## Constat (finding-id : f-review-001)

| Champ                        | Valeur                                            |
| ---------------------------- | ------------------------------------------------- |
| **Titre**                    | Fractionnement présumé — trois attributaires liés |
| **Sévérité**                 | high                                              |
| **Probabilité a posteriori** | 0.87                                              |
| **Montant cumulé**           | 287 450 000 XAF                                   |
| **Région**                   | Centre (CE)                                       |
| **Période concernée**        | 2024-10-01 → 2026-02-28                           |
| **Catégories de motif**      | A (marchés publics) + B (sociétés écran)          |
| **Nombre de signaux**        | 6 (≥ seuil CONAC 5 — art. doctrinal § 25.6.1)     |
| **Pillar de gouvernance**    | 3 votes YES / 0 NO / 0 ABSTAIN / 0 RECUSE         |

---

## Entités impliquées

### Entité primaire

**SARL Synthétique A** — société à responsabilité limitée

- **RCCM** : `RC/YAO/2019/B/12345` (synthétique)
- **NIU** : `M01926-001234567P` (synthétique)
- **Adresse déclarée** : BP 0000 Yaoundé, Cameroun (synthétique)
- **Bénéficiaires effectifs déclarés (UBO)** :
  - Personne Synthétique Un (gérant majoritaire 51 %)
  - Personne Synthétique Deux (associé 49 %)

### Entités liées (1er degré)

**SAS Synthétique B** — société par actions simplifiée

- RCCM : `RC/YAO/2020/B/67890`
- Partage l'adresse postale de SARL Synthétique A
- Bénéficiaire effectif : **Personne Synthétique Un** (même que ci-dessus)

**SARL Synthétique C** — société à responsabilité limitée

- RCCM : `RC/YAO/2021/B/11111`
- Bénéficiaire effectif : **Personne Synthétique Deux** (même que ci-dessus)

---

## Signaux contributifs

Six signaux indépendants ont contribué à la probabilité 0.87 ; chacun
référence des documents publics ancrés sur IPFS (CID + page + intervalle
de caractères) :

1. **Signal P-A-001 — Attribution sans appel d'offres ouvert**
   Évidence : `bafybeih2gqu3...{synthétique}` (Bulletin d'attribution
   Ministère X, 2024-10-15, page 3, char_span [142, 287])
   Force : 0.85, poids : 1.00, ratio de vraisemblance : 5.67

2. **Signal P-A-007 — Fractionnement sous seuil**
   Cinq tranches de 50–58 M XAF, chacune attribuée dans une fenêtre de
   45 jours, total cumulé 287 M XAF dépassant largement le seuil 90 M.
   Évidence : `bafybeih3...{synthétique}` (Bulletins X, Y, Z)
   Force : 0.92, poids : 1.00, ratio de vraisemblance : 11.50

3. **Signal P-B-002 — Bénéficiaire effectif commun**
   Les trois entités déclarent les mêmes deux UBO selon les registres
   consultés. Évidence : `bafybeih4...{synthétique}`
   Force : 0.78, poids : 0.90, ratio de vraisemblance : 4.20

4. **Signal P-B-004 — Adresse postale identique**
   Trois RCCM, une adresse BP. Évidence : `bafybeih5...{synthétique}`
   Force : 0.65, poids : 0.80, ratio de vraisemblance : 2.30

5. **Signal P-C-003 — Prix unitaire homogène anormal**
   Les cinq tranches affichent un prix au lot identique à 0.3 % près.
   Évidence : `bafybeih6...{synthétique}`
   Force : 0.71, poids : 0.85, ratio de vraisemblance : 3.10

6. **Signal P-H-002 — Séquence temporelle suspecte**
   Les cinq attributions tombent toutes dans la semaine précédant la
   clôture du budget Q4 fiscal. Évidence : `bafybeih7...{synthétique}`
   Force : 0.59, poids : 0.70, ratio de vraisemblance : 1.65

---

## Contre-évidence (passage avocat du diable — pipeline IA-Sécurité §B.4)

Le pipeline adversarial a été exécuté à la suite du score initial,
conformément à DECISION-011. Trois passes ont été effectuées :

- **Randomisation d'ordre** : trois passes du moteur Bayésien avec ordre
  d'évidence permuté. Posterior min 0.84 / max 0.89 / écart 0.05 →
  **stable** (tolérance 0.05).
- **Avocat du diable (LLM)** : narratif contraire généré, deux concerns
  potentiels identifiés (cf. ci-dessous), **non cohérent** comme
  explication alternative complète.
- **Probe contrefactuel** : retrait du signal P-A-007 (le plus fort) →
  posterior chute à 0.61 ; le constat **reste au-dessus du seuil
  d'investigation 0.55** mais **passe sous le seuil d'action 0.85** →
  **robuste mais sensible** au signal de fractionnement.
- **Revue secondaire indépendante** : posterior 0.85 → **accord** dans la
  tolérance 0.05.

### Préoccupations soulevées par l'avocat du diable

1. Les trois entités sont juridiquement distinctes ; le fractionnement
   sous seuil n'est en soi prohibé qu'avec preuve d'intention concertée.
2. L'adresse postale partagée pourrait s'expliquer par un domicile
   fiscal de complaisance utilisé indépendamment par les UBO.

### Explication alternative

Aucune explication alternative cohérente n'a été produite par le pipeline
adversarial qui rendrait compte simultanément des six signaux. Les deux
préoccupations ci-dessus sont des hypothèses partielles, non un récit
substitut.

### Étapes de vérification recommandées avant action

1. Vérifier indépendamment l'identité des UBO via consultation directe
   du Registre du Commerce et du Crédit Mobilier de la CCIMA.
2. Examiner si les cinq attributions ont été réalisées via le même
   acheteur (autorité contractante) ou des acheteurs distincts.
3. Examiner les pièces marchés (cahiers des charges, PV de
   dépouillement) pour vérifier l'éligibilité formelle des trois
   soumissionnaires.

---

## Délibération du Conseil de Gouvernance

Le constat a été soumis aux cinq piliers du conseil le 17 mai 2026.
Quorum 3-de-5 (DECISION-008 § C.5.b) :

| Pilier         | Adresse      | Vote                            | Horodatage           |
| -------------- | ------------ | ------------------------------- | -------------------- |
| Gouvernance    | `0xpillar-a` | YES                             | 2026-05-17T14:02:31Z |
| Judiciaire     | `0xpillar-b` | YES                             | 2026-05-17T14:04:18Z |
| Société civile | `0xpillar-c` | YES                             | 2026-05-17T14:07:55Z |
| Audit          | `0xpillar-d` | (non voté avant clôture quorum) |                      |
| Technique      | `0xpillar-e` | (non voté avant clôture quorum) |                      |

**Résultat : APPROUVÉ pour transmission à CONAC.**

Proposition on-chain : `proposal_index = 17` sur le contrat
`VIGILGovernance.sol` (testnet Polygon, déploiement mainnet conditionné à
W-08 / financement architecte de secours).

---

## Chaîne de garde — preuves cryptographiques

| Élément                       | Valeur                                     |
| ----------------------------- | ------------------------------------------ |
| **PDF SHA-256**               | `0000000000…{synthétique, 64 hex chars}`   |
| **IPFS CID**                  | `bafybeih{synthétique}…`                   |
| **GPG signature fingerprint** | `0000…{synthétique, 40 hex chars}`         |
| **Horodatage signature**      | 2026-05-17T14:15:00.000Z                   |
| **Ancrage audit-chain seq**   | `audit.actions[seq=12]`                    |
| **Body hash de l'ancre**      | `b9c1a4…{tiré du seeder review-demo}`      |
| **Ancrage Polygon (testnet)** | tx `0x{synthétique}` block `{synthétique}` |

La validité de cet ancrage peut être vérifiée par un tiers en consultant
publiquement :

1. La preuve d'inclusion Merkle sur `VIGILAnchor.sol` (testnet Polygon)
   pour `seq = 12`.
2. Le checkpoint signé du témoin Hyperledger Fabric (chaincode
   `audit-witness`) pour la même `seq`.
3. La CSV d'export public hebdomadaire (signée GPG) qui couvre la
   période de cet ancrage, accessible via `https://verify.vigilapex.cm/ledger`.

Les trois témoins (Postgres, Fabric, Polygon) doivent concorder sur le
`body_hash` ; toute divergence déclenche un événement
`audit.reconciliation_divergence` (cf. `docs/runbooks/audit-chain-divergence.md`).

---

## Notes de version

Document généré par VIGIL APEX, version `0.1.0`, en mode démonstration
(`VIGIL_PHASE=0`, données synthétiques). Une instance de production
émettrait :

- Une signature GPG valide (non « DEV-UNSIGNED-\* ») produite par le
  YubiKey de l'architecte ou du pilier signataire désigné.
- Un ancrage Polygon mainnet (non testnet) avec frais de gas couverts par
  le portefeuille opérationnel.
- Une transmission SFTP au serveur CONAC (et non un dépôt local) avec
  attente d'accusé de réception suivi pendant 7 jours par
  `worker-conac-sftp`.

---

> Ce document a été produit automatiquement par le système VIGIL APEX selon
> les contraintes de la doctrine AI-SAFETY-DOCTRINE-v1 (12 couches anti-
> hallucination) et de la doctrine TAL-PA (Total Action Logging with Public
> Anchoring — « le surveillant est surveillé »). Toute action menée sur le
> présent dossier (lecture par opérateur, vote du conseil, transmission)
> est elle-même horodatée dans la chaîne d'audit publiquement vérifiable.
