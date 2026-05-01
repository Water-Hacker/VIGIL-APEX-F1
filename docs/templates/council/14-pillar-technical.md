# First-contact opening dialogue — Technical pillar

> **Use:** EXEC §11.2 sample opening for the technical pillar
> candidate (typically a senior software engineer, security
> researcher, or systems engineer with no direct stake in
> Cameroonian public procurement). FR primary; EN follows.
> Same EXEC §11.3 STOP RULES.

---

## Version française

**Cadre.** Café neutre ou bureau partagé, 60–90 min, en personne ou
en visio sécurisée si la personne est hors du Cameroun. Préparer la
conversation en lisant la dernière contribution publique de la
personne (article technique, présentation à conférence, projet
open-source significatif).

**Ouverture (proposée).**

> "{{ CANDIDATE_NAME }}, merci pour ce moment.
>
> Je suis venu vous présenter un projet en construction depuis
> {{ DURATION }} qui a besoin, pour fonctionner, de quelqu'un qui
> sache lire le code et auditer les choix techniques.
>
> Le projet s'appelle VIGIL APEX. C'est une plateforme souveraine de
> surveillance des marchés publics et des flux financiers de l'État
> camerounais. Le code est en TypeScript / Python / Solidity ;
> l'infrastructure est conteneurisée ; les chaînes de confiance
> reposent sur des YubiKeys et un témoin Polygon. Le tout est
> destiné à fonctionner sur un seul nœud à Yaoundé en première
> phase, avec une fédération régionale prévue en phase 3.
>
> Avant qu'un dossier ne sorte de la plateforme vers les institutions
> mandatées (CONAC, Cour des Comptes, etc.), il passe par un conseil
> de cinq personnes qui votent à 3 voix sur 5. Je viens vous
> demander d'envisager d'être le **pilier technique** de ce conseil.
>
> Pourquoi vous. Le pilier technique porte la lecture critique du
> système. Quand un dossier sera escaladé, vous regarderez non pas
> son contenu (les autres pilliers s'en chargent) mais la chaîne
> technique qui l'a produit : est-ce que le code qui a généré ce
> dossier est celui qui est dans le dépôt public ? Est-ce que les
> hash dans la chaîne d'audit reconstruisent ce qui est censé y être ?
> Est-ce que la signature YubiKey de l'opérateur est valide ? Vous
> votez à partir de ce diagnostic.
>
> Vous n'écrirez pas le code à la place de l'équipe. Vous validez ou
> refusez l'intégrité technique. C'est une charge de garde, pas une
> charge de production.
>
> L'engagement est d'environ 30 heures par an. Pas de rémunération.
> Couverture des frais de défense et de déplacement. Une YubiKey
> personnelle vous est remise à l'enrôlement.
>
> Je ne vous demande pas de répondre aujourd'hui. Prenez 7 à 10
> jours. Avez-vous des questions ?"

**Ce qu'il faut écouter.** Le pilier technique interrogera typiquement :
la chaîne de confiance, l'auditabilité du code, la reproductibilité
des builds, la gestion des clés, la sécurité supply-chain, le risque
de capture par un fournisseur cloud unique.

**Inquiétudes attendues.**

- "Le code est-il open-source et auditable ?" → Oui ; le dépôt est
  public ; chaque commit est signé ; chaque release a un SBOM signé.
- "Comment garantissez-vous la reproductibilité des builds ?"
  → Pipeline CI public ; lock-files versionnés ; SBOM attaché à
  chaque release.
- "Quelle est la stratégie de gestion des clés ?" → YubiKeys à
  cinq pilliers (3-de-5 pour décrypter les tips citoyens) ; clé OpenPGP
  de l'architecte avec break-glass en coffre off-jurisdiction (W-08) ;
  clé Polygon-signer dédiée.
- "Comment évitez-vous la capture cloud ?" → Hetzner Falkenstein
  comme fournisseur primaire ; OVH Strasbourg en réserve ; aucun
  service spécifique à AWS/GCP/Azure dans la chaîne critique.
- "Et si je trouve une faille de sécurité ?" → Vous me le dites en
  privé d'abord ; nous corrigeons ; nous publions ensuite. Disclosure
  responsable, pas de « name and shame »."

**Clôture.**

> "Merci. Note de présentation par courriel dans 48 heures. Décision
> à votre rythme."

---

## English version

**Setting.** Neutral café or shared workspace, 60–90 min, in person
or secured video if the candidate is outside Cameroon. Prepare by
reading the candidate's most recent public contribution (technical
article, conference talk, significant open-source project).

**Opening (proposed).**

> "{{ CANDIDATE_NAME }}, thank you for the time.
>
> I came to present a project I have been building for about
> {{ DURATION }} and that, to work, needs someone who can read
> code and audit technical choices.
>
> The project is VIGIL APEX. It is a sovereign monitoring platform
> for Cameroon's public procurement and state financial flows. The
> code is TypeScript / Python / Solidity; infrastructure is
> containerised; chains of trust rest on YubiKeys and a Polygon
> witness. The whole thing runs on a single Yaoundé node in phase 1,
> with regional federation planned for phase 3.
>
> Before any dossier leaves the platform toward the mandated
> institutions (CONAC, Cour des Comptes, etc.), it passes through a
> council of five who vote 3-of-5. I am asking you to consider
> serving as the **technical pillar** of this council.
>
> Why you. The technical pillar carries the critical reading of the
> system. When a dossier is referred, you will examine not its
> content (the other pillars do that) but the technical chain that
> produced it: is the code that generated this dossier the code in
> the public repo? Do the audit-chain hashes recompute what they
> claim to? Is the operator's YubiKey signature valid? You vote on
> that diagnosis.
>
> You will not write code in place of the team. You validate or
> refuse technical integrity. It is a sentinel role, not a
> production role.
>
> About 30 hours per year. Unpaid. Legal-defence and travel covered.
> A personal YubiKey is provided at enrolment.
>
> I am not asking for an answer today. Take 7 to 10 days. Questions?"

**What to listen for.** Chain of trust, code auditability, build
reproducibility, key management, supply-chain security, cloud-vendor
capture risk.

**Expected concerns.**

- "Is the code open-source and auditable?" → Yes; the repo is
  public; every commit is signed; every release ships a signed SBOM.
- "How do you guarantee build reproducibility?" → Public CI
  pipeline; versioned lock-files; SBOM attached to each release.
- "What is the key-management strategy?" → Five-pillar YubiKeys
  (3-of-5 to decrypt citizen tips); architect's OpenPGP master with
  break-glass in off-jurisdiction safe-deposit-box (W-08); dedicated
  Polygon-signer key.
- "How do you avoid cloud capture?" → Hetzner Falkenstein as
  primary; OVH Strasbourg as fallback; no AWS/GCP/Azure-specific
  services in the critical chain.
- "What if I find a security flaw?" → You tell me privately first;
  we fix; we then publish. Responsible disclosure, no name-and-shame."

**Closing.**

> "Thank you. Brief by email within 48 hours. Decide in your own
> time."
