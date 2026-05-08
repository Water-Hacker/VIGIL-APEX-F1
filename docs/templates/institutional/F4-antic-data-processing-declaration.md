# Déclaration ANTIC / ANTIC declaration (F4 — W-23)

> **Use:** declaration to the **Agence Nationale des Technologies de
> l'Information et de la Communication (ANTIC)** of personal-data
> processing carried out by the VIGIL APEX platform, in accordance
> with Law no. 2010/012 of 21 December 2010 (cybersecurity and
> cybercrime) and Law no. 2010/013 of 21 December 2010 (electronic
> communications), and any subsequent regulatory text on
> personal-data protection enacted by ANTIC.
>
> **Drafted by the build agent**; **must be reviewed by a
> Cameroonian lawyer admitted to the bar** before being filed
> (CLAUDE.md: drafting only, not finalising). The lawyer adapts to
> the most current ANTIC declaration form, which is updated
> periodically and may require specific Annexes.

---

## Version française (à signer / à déposer)

```
{{ ARCHITECT_NAME }}
{{ ARCHITECT_TITLE }}
{{ ARCHITECT_ADDRESS_LINE_1 }}
{{ ARCHITECT_ADDRESS_LINE_2 }}
{{ ARCHITECT_EMAIL }}
{{ ARCHITECT_PHONE }}

{{ DATE_FR }}                                       Yaoundé, Cameroun

À l'attention de Monsieur le Directeur Général
Agence Nationale des Technologies de l'Information et de la
Communication (ANTIC)
B.P. 6170
Yaoundé, Cameroun

Objet : Déclaration de traitement de données à caractère personnel
        — plateforme VIGIL APEX
Référence : Loi n° 2010/012 du 21 décembre 2010 relative à la
            cybersécurité et à la cybercriminalité ; loi n° 2010/013
            du 21 décembre 2010 régissant les communications
            électroniques.

Monsieur le Directeur Général,

Conformément aux dispositions des lois susvisées et aux textes
d'application en vigueur, je me permets de déposer auprès de vos
services la présente déclaration relative au traitement de données
à caractère personnel mis en œuvre par la plateforme **VIGIL APEX**.

**1. Identification du responsable du traitement.**

| Champ                | Valeur                                  |
| -------------------- | --------------------------------------- |
| Nom et prénom        | {{ ARCHITECT_NAME }}                    |
| Qualité              | Architecte souverain, plateforme VIGIL APEX |
| Adresse postale      | {{ ARCHITECT_ADDRESS_LINE_1 }}          |
|                      | {{ ARCHITECT_ADDRESS_LINE_2 }}          |
| Adresse électronique | {{ ARCHITECT_EMAIL }}                   |
| Téléphone            | {{ ARCHITECT_PHONE }}                   |

Le projet est porté à titre individuel à la date de la présente.
Une structuration juridique (association ou entité ad hoc) est en
cours de finalisation et fera l'objet d'une déclaration modificative
dès son aboutissement.

**2. Finalité du traitement.**

La plateforme VIGIL APEX traite des données à caractère personnel à
des fins exclusives de :

a) **détection d'anomalies dans les marchés publics et les flux
   financiers de l'État camerounais** par croisement de sources
   publiquement accessibles ;

b) **production de dossiers techniques** transmis aux institutions
   mandatées (CONAC, Cour des Comptes, MINFI, ANIF) après validation
   par un conseil de gouvernance indépendant à 3 voix sur 5 ;

c) **archivage cryptographique inviolable** des actions effectuées
   sur la plateforme, à des fins de redevabilité publique
   (sous-système de journal d'actions totalement public).

Aucun traitement à des fins commerciales, publicitaires, ou de
profilage non lié à la mission décrite n'est mis en œuvre.

**3. Catégories de données traitées.**

| Catégorie | Sources | Personnes concernées |
| --- | --- | --- |
| Identités d'entreprises | RCCM, ARMP, registres internationaux | Personnes morales (entreprises soumissionnaires, attributaires de marchés) |
| Identités de dirigeants | RCCM, sources de presse, registres PEP | Personnes physiques mentionnées comme dirigeants ou bénéficiaires effectifs dans les sources publiques |
| Données financières | Décaissements publics MINFI, ARMP | Pas de données personnelles directement ; les flux sont attachés à des personnes morales |
| Décisions judiciaires | Cour des Comptes, jugements publiés | Personnes physiques nommées dans les décisions publiques |
| Données de citoyens (portail de signalements) | Citoyens volontaires via le portail Tor | Données chiffrées de bout en bout ; déchiffrement collégial (3-de-5 du conseil) |

**4. Bases légales du traitement.**

a) **Consentement** pour les signalements citoyens transmis via le
   portail Tor (loi n° 2010/012 art. relatifs au consentement).

b) **Intérêt public** pour le traitement de données déjà publiques
   concernant des marchés publics, des dirigeants d'entreprises
   attributaires, et des décisions de justice publiées (art.
   pertinents de la loi sur l'accès à l'information publique).

c) **Obligation légale** pour la transmission aux institutions
   mandatées par la loi de poursuivre la lutte anti-corruption (en
   particulier la CONAC, créée par décret 2006/088).

**5. Mesures de sécurité.**

| Mesure | Description |
| --- | --- |
| Chiffrement au repos | Chaque base de données est chiffrée (LUKS niveau disque + chiffrement applicatif sur les colonnes sensibles) |
| Chiffrement en transit | TLS 1.3 obligatoire ; communications gRPC entre nœuds régionaux signées et chiffrées (mTLS) |
| Authentification matérielle | Toute opération privilégiée requiert une YubiKey ; aucun mot de passe simple |
| Journal inviolable | Sous-système TAL-PA : chaque action est inscrite dans une chaîne de hash, signée par YubiKey, et ancrée quotidiennement sur la blockchain Polygon |
| Hébergement | Hetzner Falkenstein (Allemagne) en primaire, OVH Strasbourg en réserve ; aucune dépendance critique à un fournisseur cloud unique |
| Sauvegarde | Sauvegarde nocturne chiffrée (clé OpenPGP de l'architecte), copie miroir hors-juridiction |
| Contrôle d'accès | Conseil de gouvernance à 5 personnes, vote 3-de-5 pour escalade et 4-de-5 pour libération publique |

**6. Durées de conservation.**

| Catégorie | Durée |
| --- | --- |
| Sources publiques agrégées | Indéfinie (re-collectables ; archivage immuable) |
| Dossiers techniques produits | Indéfinie (archivage immuable, ancrage Polygon) |
| Signalements citoyens chiffrés | Indéfinie tant que le portail public reste actif ; déchiffrement collégial uniquement sur vote |
| Identifiants des contributeurs | Aucun : le portail Tor est anonyme par conception |

**7. Droits des personnes concernées.**

Les personnes dont les données figurent dans une source publique
agrégée disposent du droit :

- d'accès et d'information sur les données les concernant ;
- de rectification factuelle si une donnée publique est devenue
  inexacte ;
- d'opposition à un traitement disproportionné par rapport à la
  finalité publique.

Compte tenu de la nature exclusivement publique des sources et de la
finalité d'intérêt public, le **droit à l'effacement** s'exerce dans
les conditions et limites prévues par les textes (notamment :
préservation des archives à des fins d'intérêt public archivistique,
conformément à l'esprit du règlement européen sur la protection des
données et aux principes équivalents en droit camerounais).

Toute demande d'exercice de ces droits peut être adressée au
responsable du traitement à l'adresse mentionnée en tête de la
présente.

**8. Transferts hors du Cameroun.**

L'hébergement primaire des serveurs se trouve actuellement chez
Hetzner Online GmbH à Falkenstein (Allemagne). Cette localisation
est motivée par des considérations de souveraineté technique
(juridiction européenne reconnue pour la protection des données,
absence de Patriot Act). Le transfert vers l'Allemagne n'implique
aucune communication des données à des tiers commerciaux.

Une migration vers un hébergement souverain au Cameroun est planifiée
dès qu'un opérateur conforme aux exigences techniques (disponibilité
99,9 %, résistance physique, certifications de sécurité) sera
disponible.

**9. Pièces jointes.**

- Note de présentation de la plateforme (3 pages)
- Liste des 27 sources publiques agrégées
- Architecture de sécurité (3 pages)
- Composition du conseil de gouvernance
- Politique de confidentialité publiée

**10. Engagements complémentaires.**

Je m'engage à :

- déclarer toute modification substantielle du traitement à l'ANTIC
  dans un délai de trente (30) jours ;
- notifier l'ANTIC en cas d'incident de sécurité affectant la
  confidentialité ou l'intégrité des données traitées, dans les
  délais prévus par la loi ;
- mettre à disposition de l'ANTIC, à sa demande, les preuves
  techniques attestant du respect des mesures de sécurité décrites
  au paragraphe 5.

Je reste à votre disposition pour toute information complémentaire et
pour une présentation technique de la plateforme.

Veuillez agréer, Monsieur le Directeur Général, l'expression de ma
haute considération.

{{ ARCHITECT_NAME }}
Architecte souverain, plateforme VIGIL APEX
[Signature]
```

---

## Architect's notes (do NOT include in filed declaration)

**Hand-off to a Cameroonian lawyer** before submission. Verify:

1. ANTIC's current declaration form. ANTIC may have moved to an
   electronic submission portal since 2010/012 was enacted; the
   lawyer adapts.
2. The most recent regulatory text on personal data. Cameroon has
   been working on a dedicated personal-data-protection bill;
   if it has been enacted at submission time, the declaration must
   reference it explicitly.
3. The address/B.P. of ANTIC. Verify against ANTIC's current
   official publication (the address may have changed).
4. Whether the architect needs to be a registered legal entity
   (association loi 1990, SARL ad hoc, or otherwise) before the
   declaration is filed. Filing as a natural person is acceptable
   today; an entity may be required later.
5. Whether the citizen-tip portal triggers a separate declaration
   under the 2010/013 e-communications law (the lawyer determines
   whether the platform's tip endpoint counts as a "service de
   communication électronique" requiring separate registration).

**What was deliberately NOT included.**

- Names of council members. ANTIC does not need them at this
  declaration stage; identity disclosure is governed by the
  council's own self-disclosure vote (4-of-5).
- Source code. ANTIC's mandate is data-processing oversight, not
  code review.
- Names of CONAC contacts. The architect's relationship with CONAC
  is documented separately (F3.1 letter); ANTIC does not need that
  pipeline detail.

**Submission cadence.** EXEC §15.4 says the CONAC engagement letter
goes out AFTER council formation, BEFORE Phase 6. The ANTIC
declaration should be filed **before** the platform begins ingesting
citizen tips at scale — i.e., before Phase 5 (tip ingestion). If the
council is not yet formed when Phase 5 starts, the architect files
this declaration as a natural person and updates it once the council
is formed and any legal entity registered.

---

## English translation (record only — not for filing)

> **Note.** ANTIC operates in French (Cameroon's primary
> administrative language for technical regulation). The English
> version below exists for the project's bilingual archival record.
> Filing is in French; the lawyer should not produce an English
> version for ANTIC.

(English translation not produced here to avoid template
proliferation; if the architect needs an EN record copy, it can be
generated from the FR version above by translating §1–§10
verbatim. The substantive content is identical.)
