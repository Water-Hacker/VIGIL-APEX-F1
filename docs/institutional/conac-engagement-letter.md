# CONAC engagement letter — template

**Audience:** Commission Nationale Anti-Corruption (CONAC), République
du Cameroun, Yaoundé.
**Sender:** Junior Thuram Nana, Sovereign Architect, VIGIL APEX SAS.
**Channel:** Paper, signed in ink, registered post + a courtesy
hand-delivery to the CONAC secretariat.
**Bilingual:** FR primary (the binding text), EN companion below for
the architect's records and any post-send translation review.
**Source-of-truth contract:** v5.1 commercial agreement of 2026,
clauses §1, §3, §11, §22.

---

## Version française (à signer et expédier)

> Référence : **VIGIL/CONAC/<<FILL: YYYY-MM-DD-NNN>>**
> Objet : Proposition d'engagement institutionnel — plateforme VIGIL APEX
> Date : <<FILL: jour mois année, par ex. « 28 avril 2026 »>>

À l'attention de :
> Monsieur le Président de la Commission Nationale Anti-Corruption,
> Commission Nationale Anti-Corruption (CONAC),
> Boîte Postale 33200, Yaoundé,
> République du Cameroun.

Monsieur le Président,

J'ai l'honneur de solliciter, au nom de la société **VIGIL APEX SAS**,
l'attention de Votre Haute Autorité sur la mise en service de la
plateforme **VIGIL APEX** — Système de surveillance et de
renseignement en temps réel pour la conformité des finances publiques
camerounaises — dont le déploiement Phase 1 est en cours conformément
à l'accord commercial v5.1 que la République du Cameroun et notre
société ont signé en 2026.

### 1. Ce que la plateforme livre

VIGIL APEX agrège, exclusivement à partir de **données publiques**
légalement accessibles, les flux d'attribution de marchés (ARMP),
d'inscription au registre fiscal (DGI), de publications au Journal
Officiel et des sources sectorielles équivalentes. Le moteur applique
**43 patrons de détection** de fraude et anomalies couvrant huit
catégories définies par le SRD §21, attribue à chaque constat une
**probabilité postérieure bayésienne** calibrée pour un Expected
Calibration Error inférieur à 5 %, puis livre — après vote du conseil
3-sur-5 décrit ci-dessous — un **dossier signé bilingue** par voie
SFTP sécurisée, conforme au format VIGIL APEX § Annexe Format-Adapter
v1.

Tous les dossiers sont **ancrés cryptographiquement** sur la chaîne
publique Polygon (transaction-hash vérifiable par tout citoyen sur
verify.vigilapex.cm) et **témoignés en parallèle** sur le ledger
permissionné Hyperledger Fabric. La chaîne d'intégrité est vérifiable
sans dépendre d'aucun service contrôlé par VIGIL APEX SAS.

### 2. Ce que nous demandons à la CONAC

Nous proposons à Votre Haute Autorité **un engagement institutionnel
limité, encadré, et révocable à tout moment**, comportant :

- **Un point de contact technique** désigné au sein de la CONAC, avec
  qui nous coordonnerons (a) la cadence de livraison des dossiers,
  (b) le format précis des manifestes accompagnant chaque dossier,
  et (c) le mécanisme d'accusé de réception, conformément au § 25.4
  du SRD.
- **Une lecture amiable** des trois premiers dossiers livrés. Cette
  lecture nous permettra de calibrer notre seuil d'escalade et notre
  rédaction afin que les dossiers que recevra ensuite la CONAC soient
  exploitables sans ajustement éditorial.
- **Une participation, à votre seule discrétion**, d'un magistrat ou
  d'un commissaire de la CONAC au pilier judiciaire du Conseil de
  Surveillance VIGIL APEX (description ci-dessous, § 4). Cette
  participation est **strictement institutionnelle** : la CONAC reste
  l'autorité décisionnelle finale ; la plateforme produit des
  hypothèses étayées, jamais des verdicts.

### 3. Ce que la CONAC reçoit

- Des dossiers d'enquête **prêts à être instruits**, accompagnés de
  toutes les pièces probatoires citées et d'une référence on-chain
  vérifiable, livrés dans un format machine-lisible **et** un format
  imprimable bilingue.
- Une **API de scoring temps-réel** (worker-minfi-api, déjà déployée
  sous mTLS) que la CONAC peut interroger au moment d'instruire un
  marché, pour obtenir une bande de risque green/amber/orange/red
  signée numériquement et opposable.
- Une **garantie de souveraineté** : toute l'infrastructure est
  hébergée physiquement au Cameroun (SRD §3), et la base de droit
  applicable est la juridiction camerounaise.

### 4. Le Conseil de Surveillance — pour l'information de la CONAC

L'escalade d'un constat vers un dossier livrable suppose un vote
**3-sur-5** d'un Conseil de Surveillance composé de cinq piliers
indépendants : judiciaire, société civile, académique, technique et
religieux. Aucune escalade ne franchit la chaîne de livraison sans ce
vote. Les votes sont enregistrés on-chain avec récusations explicites.

### 5. Ce que nous engageons

- **Aucune intrusion** dans des systèmes non publics. La plateforme
  cesse de fonctionner si elle perd l'accès aux données publiques —
  elle n'a aucun chemin alternatif.
- **Aucun usage commercial des constats** au-delà de leur livraison à
  la CONAC. Nous ne vendons ni ne syndicons les dossiers ; nous ne
  monétisons pas le moteur.
- **Une obligation de réponse** sur tout constat susceptible de
  préjudicier à une personne nommée : la chaîne de témoins
  (Postgres + Polygon + Fabric + verify.vigilapex.cm) garantit que
  toute correction d'erreur factuelle est traçable et publique.
- **Un mécanisme d'arrêt** : sur lettre signée par Votre Haute
  Autorité, la plateforme suspend la livraison de dossiers vers la
  CONAC dans un délai de quarante-huit heures, sans préjudice des
  obligations contractuelles de l'accord v5.1 §11.

### 6. Demande

Je sollicite respectueusement de Votre Haute Autorité **un avis
favorable de principe** à l'engagement décrit, suivi de la
désignation du point de contact technique mentionné au § 2. Nous nous
tenons à la disposition de Votre Haute Autorité pour toute
clarification, en personne au siège de la CONAC ou par un canal de
communication de votre choix.

Je vous prie d'agréer, Monsieur le Président, l'expression de ma haute
considération.

> **Junior Thuram Nana**
> Architecte Souverain, VIGIL APEX SAS
> satoshinakamotobull@gmail.com
> <<FILL: téléphone direct>>
> <<FILL: adresse postale Cameroun>>

**Pièces jointes :**
- Une copie du SRD v3 (pour information non-contraignante).
- Une copie de l'accord commercial v5.1 (mentionnée pour référence).
- L'avis juridique préliminaire du conseil VIGIL APEX SAS sur la
  conformité à la Loi 2010/021 (cybersécurité).
- L'attestation de déclaration ANTIC, le cas échéant (annexe à
  fournir une fois la déclaration prévue à `antic-declaration.md`
  acceptée).

---

## English version (architect's records — not for sending)

> Reference: **VIGIL/CONAC/<<FILL: YYYY-MM-DD-NNN>>**
> Subject: Proposal for institutional engagement — VIGIL APEX platform
> Date: <<FILL: day month year>>

To:
> The President,
> Commission Nationale Anti-Corruption (CONAC),
> P.O. Box 33200, Yaoundé,
> Republic of Cameroon.

Mr. President,

On behalf of **VIGIL APEX SAS** I respectfully bring to your high
authority's attention the activation of **VIGIL APEX** — Real-Time
Public Finance Compliance, Governance Monitoring & Intelligence
Platform — whose Phase-1 deployment proceeds in line with the v5.1
commercial agreement signed by the Republic of Cameroon and our
company in 2026.

### 1. What the platform delivers

VIGIL APEX aggregates, **exclusively from publicly accessible data**,
the streams of public-procurement awards (ARMP), tax-registry filings
(DGI), Official Gazette publications, and equivalent sectoral
sources. The engine applies **43 fraud-detection patterns** spanning
the eight SRD §21 categories, assigns each finding a **Bayesian
posterior probability** calibrated for an Expected Calibration Error
under 5%, and — after a 3-of-5 council vote described below —
delivers a **signed bilingual dossier** over secure SFTP in the
VIGIL APEX format-adapter v1 specification.

Every dossier is **cryptographically anchored** on the Polygon public
chain (transaction hash verifiable by any citizen on
verify.vigilapex.cm) and **mirrored** on a permissioned Hyperledger
Fabric ledger. The integrity chain is verifiable without trusting any
VIGIL APEX SAS-controlled service.

### 2. What we ask of CONAC

We propose a **bounded, structured, and revocable institutional
engagement**, comprising:

- **A designated technical point of contact** within CONAC,
  coordinating (a) dossier delivery cadence, (b) the precise manifest
  format, and (c) the acknowledgement mechanism per SRD § 25.4.
- **A friendly read-through** of the first three dossiers we deliver.
  This calibrates our escalation threshold and editorial voice so
  that subsequent dossiers are actionable without further editorial
  iteration.
- **At your sole discretion**, the participation of a CONAC magistrate
  or commissioner in the judicial pillar of the VIGIL APEX
  Governance Council (described in §4). Participation is **purely
  institutional**: CONAC retains final adjudicatory authority; the
  platform produces evidenced hypotheses, never verdicts.

### 3. What CONAC receives

- **Investigation-ready dossiers** with cited evidence and a
  verifiable on-chain reference, in both machine-readable and
  printable bilingual format.
- A **real-time scoring API** (worker-minfi-api, already deployed
  under mTLS) that CONAC may query when assessing a contract, with
  signed green/amber/orange/red risk-band responses.
- A **sovereignty guarantee**: the entire infrastructure is
  physically hosted in Cameroon (SRD §3) under Cameroonian
  jurisdiction.

### 4. The Governance Council — for CONAC's information

Escalation of a finding to a deliverable dossier requires a **3-of-5
vote** of a Governance Council composed of five independent pillars:
judicial, civil society, academic, technical, religious. No
escalation reaches the delivery chain without that vote. Votes are
recorded on-chain with explicit recusals.

### 5. What we commit to

- **No intrusion** into non-public systems. The platform stops
  functioning if it loses access to public data — there is no
  alternative path.
- **No commercial use of findings** beyond delivery to CONAC. We
  neither sell nor syndicate dossiers; we do not monetise the engine.
- **A right of correction** on any finding that may prejudice a
  named person: the witness chain (Postgres + Polygon + Fabric +
  verify.vigilapex.cm) ensures that every factual correction is
  traceable and public.
- **A halt mechanism**: upon a letter signed by your high authority
  the platform suspends dossier delivery to CONAC within 48 hours,
  without prejudice to the contractual obligations of the v5.1
  agreement §11.

### 6. Request

I respectfully request your high authority's **agreement in principle**
to the engagement described above, followed by designation of the
technical point of contact mentioned in §2. We remain at your
disposal for any clarification, in person at CONAC headquarters or
through any channel of your choice.

Yours respectfully,

> **Junior Thuram Nana**
> Sovereign Architect, VIGIL APEX SAS
> satoshinakamotobull@gmail.com
> <<FILL: direct phone>>
> <<FILL: Cameroon mailing address>>

**Enclosures:**
- A copy of the SRD v3 (informational, non-binding).
- A copy of the v5.1 commercial agreement (for reference).
- VIGIL APEX SAS legal counsel's preliminary opinion on compliance
  with Loi 2010/021 (cybersecurity).
- The ANTIC declaration receipt, if available (to be appended once
  the declaration described in `antic-declaration.md` is accepted).

---

## Architect-only handling notes

- **Do not send before** the ANTIC declaration is filed. CONAC will
  ask. Filing first lets you attach the declaration receipt to this
  letter as an enclosure, which materially shortens the response loop.
- **Do not include MOU language with MINFI / BEAC / ANIF** in this
  letter. CONAC has no view into those negotiations and mentioning
  them invites reply requests we cannot answer.
- **The "halt mechanism" §5 paragraph** is non-negotiable. Counsel
  flagged it in pre-review as the single thing that converts the
  letter from unwelcome into welcome — leave it in.
- **Three printed copies**: one to CONAC, one for the architect's
  signed file, one for the council-quorum-encrypted backup at
  `/srv/vigil/architect-archive/`.
- After send: append an `audit.actions` row with `action =
  institutional.send.conac` and the AB-12-character SHA-256 prefix
  of the signed PDF, then add a `docs/decisions/log.md` entry
  per `INDEX.md` step 4.
