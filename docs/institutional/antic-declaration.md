# ANTIC declaration — template under Loi n° 2010/012 du 21 décembre 2010

**Audience:** Agence Nationale des Technologies de l'Information et de
la Communication (ANTIC), République du Cameroun, Yaoundé.
**Sender:** VIGIL APEX SAS, represented by Junior Thuram Nana,
Sovereign Architect.
**Channel:** ANTIC online declarations portal at
`https://www.antic.cm/declarations` (or paper if the portal is
unreachable). Architect's counsel reviews and validates **before**
submission — Loi 2010/012 violations carry CFA 5 M – CFA 50 M fines.
**Reference statute:** Loi n° 2010/012 du 21 décembre 2010 portant sur
la cybersécurité et la cybercriminalité au Cameroun, articles 41–46
(declaration regime for personal-data processing systems).
**Bilingual:** FR primary (the binding form text); EN below for the
architect's records.

---

## Préambule juridique (à confirmer avec le conseil avant envoi)

La Loi n° 2010/012 art. 41 oblige toute personne morale exploitant un
système de traitement automatisé de données personnelles sur le
territoire camerounais à effectuer une déclaration préalable auprès
de l'ANTIC. La présente déclaration est rédigée pour VIGIL APEX dans
le cadre du déploiement Phase 1 de la plateforme.

**Fait juridique :** la plateforme VIGIL APEX traite des données
personnelles au sens de l'art. 4 de la loi (données permettant
d'identifier directement ou indirectement une personne physique),
notamment :

- Noms de dirigeants d'entreprises (RCCM, OpenCorporates, registres
  étrangers).
- Noms de personnes politiquement exposées (PEP) figurant dans les
  registres ANIF, OFAC, EU-CFSP, UN-1267.
- Noms de fonctionnaires et magistrats apparaissant au Journal
  Officiel.
- Adresses IP des soumetteurs du portail de signalements
  (conservation 7 jours, anti-abus exclusivement).

Le traitement repose sur (a) **l'intérêt public** à lutter contre la
corruption des finances publiques, (b) le **consentement explicite**
des soumetteurs de signalements, et (c) **l'accord commercial v5.1**
signé avec la République du Cameroun en 2026.

---

## Formulaire de déclaration

### Section 1 — Identification du responsable du traitement

| Champ | Valeur |
|---|---|
| Dénomination sociale | VIGIL APEX SAS |
| Forme juridique | Société par Actions Simplifiée (SAS) |
| Numéro RCCM | <<FILL: numéro d'immatriculation au registre du commerce>> |
| Numéro NIU | <<FILL: numéro d'identifiant unique fiscal>> |
| Siège social | <<FILL: adresse complète>> |
| Représentant légal | Junior Thuram Nana, Architecte Souverain |
| Adresse électronique | satoshinakamotobull@gmail.com |
| Téléphone | <<FILL: ligne directe>> |
| Délégué à la protection des données (DPO) | <<FILL: nom du DPO ; si l'architecte assume le rôle, l'indiquer>> |

### Section 2 — Identification du système de traitement

| Champ | Valeur |
|---|---|
| Nom du système | VIGIL APEX — Plateforme de surveillance et de renseignement en temps réel pour la conformité des finances publiques |
| Localisation physique | République du Cameroun (souveraineté de l'hébergement par conception, SRD §3). Adresse précise du centre de données : <<FILL: adresse Yaoundé>>. Site de réplique : <<FILL: adresse Hetzner Falkenstein, Allemagne, sous accord de souveraineté §11 de l'accord v5.1>>. |
| Date de mise en service prévisionnelle | <<FILL: date>> (déploiement Phase 1) |
| Finalité(s) du traitement | (1) Détection automatique de patrons de fraude dans les marchés publics camerounais à partir de sources publiques. (2) Production de constats et de dossiers d'enquête livrés à la Commission Nationale Anti-Corruption (CONAC) et au Ministère des Finances. (3) Exposition d'une surface publique de vérification (verify.vigilapex.cm) permettant à tout citoyen d'attester de l'intégrité d'un dossier publié. |
| Base légale | (a) Intérêt public — Article 9 de la loi 2010/012 ; (b) Consentement explicite des soumetteurs de signalements ; (c) Accord commercial v5.1 du 2026 entre VIGIL APEX SAS et la République du Cameroun. |

### Section 3 — Catégories de données traitées

| Catégorie | Source | Conservation | Sensibilité |
|---|---|---|---|
| Identités d'entreprises (RCCM, NIU, raison sociale, dirigeants) | RCCM-Cameroun, OpenCorporates, OCCRP Aleph | Durée illimitée tant que pertinent (sources publiques persistantes) | Standard |
| Identités de personnes physiques nommées dans des sources publiques (Journal Officiel, listes PEP, listes de sanctions) | Journal Officiel, ANIF, OFAC, EU-CFSP, UN-1267, OpenSanctions | Durée illimitée tant que pertinent | **Sensible** — usage strictement encadré |
| Adresses IP des soumetteurs du portail tip.vigilapex.cm | Caddy access-log | **7 jours** (anti-abus exclusivement, purge irréversible) | Sensible — cycle court |
| Texte chiffré de signalements (libsodium sealed-box, jamais déchiffré côté serveur en clair) | Portail tip.vigilapex.cm | Jusqu'à disposition du conseil + 1 an | Sensible — chiffré au repos et en mémoire |
| Journaux d'audit opérateur (consultation des dossiers, votes du conseil) | Postgres `audit.actions` + Hyperledger Fabric | **7 ans** (loi 2010/012 art. 26) | Standard |

### Section 4 — Mesures techniques et organisationnelles (Loi 2010/012 art. 41 al. 3)

- **Chiffrement au repos** : LUKS2 sur l'ensemble des volumes de
  stockage (host + Synology), clés gérées par TPM Clevis + YubiKey
  FIDO2 (HSK §04).
- **Chiffrement en transit** : TLS 1.3 sur tout trafic externe ;
  WireGuard pour l'inter-site ; mTLS sur l'API MINFI.
- **Authentification** : FIDO2 / YubiKey 5C NFC obligatoire pour
  tout accès opérateur ou conseil (Keycloak `webauthn` policy).
- **Cloisonnement** : `restricted` Pod Security Standards (K8s
  Phase 2) ou Docker `no-new-privileges` (Phase 1) ; NetworkPolicy
  par défaut-refus.
- **Audit immutable** : chaîne de hachage Postgres `audit.actions`
  hebdomadairement ancrée sur Polygon mainnet ; témoin parallèle sur
  Hyperledger Fabric (Phase 2).
- **Sauvegarde et reprise** : sauvegarde quotidienne signée GPG
  (vigil-backup), RTO 6 heures (docs/RESTORE.md). Test quarterly.
- **Cycle de vie des secrets** : rotation trimestrielle des
  identifiants opérateurs et des clés on-chain (vigil-key-rotation).
- **Surveillance et détection d'anomalies** : Prometheus +
  AlertManager + 5 tableaux Grafana ; règle de quorum 2-sur-3 entre
  les sentinelles externes (Helsinki / Tokyo / NYC).
- **Délégué à la protection des données** : <<FILL: nom + email>>.
  Le DPO est indépendant de l'équipe d'exploitation et rapporte
  directement à l'Architecte.

### Section 5 — Transferts internationaux (Loi 2010/012 art. 25)

| Type de transfert | Vers | Garantie |
|---|---|---|
| Anchors cryptographiques (racines Merkle, jamais texte clair) | Polygon mainnet (chaîne publique mondiale) | La donnée transférée est une **valeur de hachage** sans information personnelle ; conformité art. 25 par non-applicabilité |
| Sauvegarde de réplique | Hetzner Falkenstein (Allemagne) | Cadre du Conseil de l'Europe Convention 108+ ; clauses contractuelles types ; chiffrement bout-en-bout par clé non détenue par l'hébergeur |
| Appels API LLM (Anthropic Claude pour les patrons textuels) | Anthropic, San Francisco, États-Unis | Données envoyées : extraits de **sources publiques** déjà publiées ; jamais de données de signalement ; jamais d'identités non publiques. Le contrat Anthropic Enterprise interdit la réutilisation pour entraînement (zero-retention) |

### Section 6 — Engagements

VIGIL APEX SAS s'engage à :
- Notifier l'ANTIC dans les **soixante-douze heures** de toute
  violation de données personnelles susceptible de porter atteinte aux
  droits des personnes concernées (art. 41 al. 5).
- Mettre à jour la présente déclaration dans les **trente jours** de
  toute modification matérielle des finalités, catégories de données
  ou transferts internationaux.
- Tenir un **registre des traitements** conformément à l'art. 41
  al. 7, accessible à l'ANTIC sur demande.
- Permettre à toute personne physique nommée dans un dossier publié
  d'exercer ses droits d'information, de rectification et de plainte
  via dpo@vigilapex.cm. Le formulaire de demande figure sur
  https://vigilapex.cm/privacy.
- Coopérer avec toute mission d'inspection diligentée par l'ANTIC
  sur le fondement de l'art. 43.

### Section 7 — Pièces jointes

- Statuts de la société VIGIL APEX SAS.
- Avis juridique du conseil VIGIL APEX SAS sur la conformité à la
  Loi 2010/012 (référence : <<FILL: référence du dossier conseil>>).
- Architecture de la plateforme (extrait du SRD v3, sections 3, 5, 7,
  17, 28).
- Politique de protection des données (extrait du dossier ANTIC
  associé, page consolidée disponible à
  https://vigilapex.cm/privacy).

### Signature

> Fait à <<FILL: ville>>, le <<FILL: date>>.
>
> Pour VIGIL APEX SAS :
> **Junior Thuram Nana**
> Architecte Souverain et représentant légal

---

## English version (architect's records — not for filing)

> *The ANTIC portal accepts French only. The English text below is
> intentionally a faithful summary, not a translation, kept by the
> architect for cross-jurisdictional correspondence.*

VIGIL APEX SAS hereby files a declaration under Loi n° 2010/012 art.
41 for the personal-data processing system named **VIGIL APEX**.

The platform aggregates exclusively from public sources (procurement
awards, tax registry, gazette, sanctions lists) and processes:

- **Public-record identities** of companies (RCCM, NIU, directors)
  and natural persons named in those records — retention indefinite
  while relevant.
- **PEP and sanctions records** from ANIF, OFAC, EU-CFSP, UN-1267,
  OpenSanctions — sensitive, strictly bounded use.
- **Tip-portal IP addresses** — 7 days for abuse mitigation, then
  irreversibly purged.
- **Encrypted tip ciphertext** — server never holds plaintext;
  decryption gated on a 3-of-5 council Shamir quorum.
- **Operator audit log** — 7 years per art. 26.

Lawful bases are (a) public interest in fighting public-finance
corruption, (b) explicit consent from tip submitters, (c) the v5.1
commercial agreement.

Technical safeguards: LUKS2 at rest, TLS 1.3 + WireGuard + mTLS in
transit, FIDO2-only operator auth, Pod Security Standards
`restricted`, append-only audit chain anchored on Polygon, GPG-signed
daily backups (vigil-backup, RTO 6h), quarterly key rotation
(vigil-key-rotation).

Cross-border transfers limited to (1) cryptographic root commitments
(no personal content), (2) the Hetzner Falkenstein replica under CoE
Convention 108+ + standard contractual clauses + end-to-end
encryption, (3) Anthropic Claude API calls on **already-public** text
under the zero-retention enterprise contract.

The architect commits to 72-hour breach notification, registry of
processing activities under art. 41 al. 7, support for data-subject
rights via dpo@vigilapex.cm, and full cooperation with ANTIC
inspections under art. 43.

---

## Architect-only handling notes

- **Counsel review is mandatory.** Loi 2010/012 violations are
  criminal, not just administrative — the fines start at CFA 5 M and
  reach CFA 50 M, plus imprisonment in aggravated cases. Submit
  through counsel; do not file unilaterally.
- **The DPO designation §1.last is non-negotiable.** ANTIC will
  reject incomplete declarations. If the architect is also the DPO,
  state it explicitly and document the architect-as-DPO appointment
  letter in `docs/institutional/architect-as-dpo-appointment.md`
  (not yet drafted; create at file-time if needed).
- **The processing-activity registry §6.3** must exist before this
  declaration files. The registry's source is `docs/SLOs.md`
  + `infra/sources.json` + `docs/decisions/log.md` rolled up into
  the official format ANTIC requires (CSV per the 2024 ANTIC
  procedure note). Counsel handles the format conversion.
- **Do NOT include the council-pillar list** in §1. ANTIC has no
  jurisdiction over the council; mentioning them invites overreach.
- After acceptance: ANTIC issues a registration receipt with a
  unique declaration number. That number goes into:
  - `apps/dashboard/src/app/privacy/page.tsx` (replaces the
    `NEXT_PUBLIC_ANTIC_DECLARATION_URL` placeholder).
  - The CONAC engagement letter §5 enclosure list.
  - `docs/decisions/log.md` as `<DATE> — ANTIC declaration accepted,
    number <NUMBER>`.
- **Three printed copies** + the digital portal submission. The
  printed copies (one to ANTIC counter as backup, one to architect
  file, one to council-quorum-encrypted backup).
