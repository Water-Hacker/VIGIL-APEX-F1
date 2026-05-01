# First-contact opening dialogue — Audit pillar

> **Use:** EXEC §11.2 sample opening for the audit pillar candidate
> (typically a senior chartered accountant, ex-Cour-des-Comptes
> magistrat, or veteran internal auditor in a public-sector
> institution). FR primary; EN follows. Same EXEC §11.3 STOP RULES.

---

## Version française

**Cadre.** Café neutre, 60–90 min, en personne. Avant la rencontre,
lire le dernier rapport public sur lequel la personne a travaillé
(rapport de la Cour des Comptes, audit institutionnel publié,
mémoire universitaire en finance publique).

**Ouverture (proposée).**

> "{{ CANDIDATE_NAME }}, merci d'avoir bien voulu me recevoir.
>
> Je suis venu vous parler d'un projet qui se construit depuis
> {{ DURATION }} et qui a besoin, pour fonctionner sérieusement,
> d'un regard d'expert-comptable et d'auditeur sur ses sorties.
>
> Le projet s'appelle VIGIL APEX. C'est une plateforme souveraine de
> surveillance des marchés publics et des flux financiers de l'État
> camerounais. Elle agrège des sources publiques, applique 43
> motifs de fraude calibrés, et produit des dossiers techniques pour
> les institutions mandatées — CONAC, Cour des Comptes, MINFI, ANIF.
>
> Chaque dossier que la plateforme produit avant escalade contient :
> un calcul bayésien documenté du niveau de soupçon, les sources
> primaires citées, les hypothèses retenues et écartées. Avant
> qu'un dossier ne sorte, il passe par un conseil de cinq personnes
> qui valident à 3 voix sur 5 ou refusent.
>
> Je viens vous demander d'envisager d'être le **pilier audit** de ce
> conseil. Le pilier audit porte la lecture comptable et la rigueur
> méthodologique. Quand un dossier dit qu'un marché public a été
> attribué à un montant suspect ou décaissé hors séquence, vous
> regarderez le calcul, les sources, le raisonnement bayésien, et
> direz si vous le mettriez devant un comité d'audit. Si vous ne le
> mettriez pas, vous votez non.
>
> Vous n'auditez pas vous-même les ministères. Vous validez la
> méthode et la rigueur de la plateforme. C'est une charge de
> contrôle qualité, pas une mission d'audit.
>
> L'engagement est d'environ 30 heures par an. Pas de rémunération.
> Couverture des frais de défense et de déplacement.
>
> Je ne vous demande pas de répondre aujourd'hui. Prenez 7 à 10
> jours. Avez-vous des questions ?"

**Ce qu'il faut écouter.** Le pilier audit interrogera typiquement :
la traçabilité des chiffres, la stabilité des seuils, la
reproductibilité, la sensibilité du calcul aux entrées, l'absence de
biais dans le choix des motifs.

**Inquiétudes attendues.**

- "Comment savez-vous que vos seuils ne génèrent pas de faux
  positifs en masse ?" → Calibrage continu (W-14 + W-16) ; mesure
  trimestrielle de l'erreur de calibration (ECE) ; tableau public.
- "Pouvez-vous reproduire un dossier ?" → Oui : entrées figées,
  paramètres versionnés, posterior recalculable. La reproductibilité
  est testée à chaque mise en production.
- "Qui contrôle la plateforme elle-même ?" → Le conseil ; un sous-
  système TAL-PA enregistre chaque action sur la plateforme et l'ancre
  publiquement (Polygon).
- "Et si je détecte une erreur méthodologique ?" → Vous votez non,
  vous l'écrivez dans le procès-verbal. Le conseil ne libère pas un
  dossier que vous récusez.

**Clôture.**

> "Merci. Note de présentation par courriel dans 48 heures. Décision
> à votre rythme."

---

## English version

**Setting.** Neutral café, 60–90 min, in person. Before the meeting,
read the candidate's most recent public report (Court of Accounts
report, published institutional audit, public-finance academic
paper).

**Opening (proposed).**

> "{{ CANDIDATE_NAME }}, thank you for receiving me.
>
> I came to discuss a project I have been building for about
> {{ DURATION }} and that, to work seriously, needs the eye of a
> chartered accountant and auditor on its outputs.
>
> The project is VIGIL APEX. It is a sovereign monitoring platform
> for Cameroon's public procurement and state financial flows. It
> aggregates public sources, applies 43 calibrated fraud patterns,
> and produces technical dossiers for the mandated institutions —
> CONAC, Cour des Comptes, MINFI, ANIF.
>
> Each dossier the platform produces, before escalation, contains: a
> documented Bayesian calculation of the suspicion level, the
> primary sources cited, the hypotheses kept and rejected. Before
> any dossier leaves, it passes through a council of five who
> confirm at 3-of-5 or refuse.
>
> I am asking you to consider serving as the **audit pillar** of
> this council. The audit pillar carries the accounting reading and
> the methodological rigour. When a dossier asserts that a public
> contract was awarded at a suspect amount or disbursed out of
> sequence, you will examine the calculation, the sources, the
> Bayesian reasoning, and say whether you would put it in front of
> an audit committee. If you would not, you vote no.
>
> You will not audit ministries yourself. You validate the platform's
> method and rigour. It is a quality-control role, not an audit
> mission.
>
> About 30 hours per year. Unpaid. Legal-defence and travel covered.
>
> I am not asking for an answer today. Take 7 to 10 days. Do you
> have questions?"

**What to listen for.** Number traceability, threshold stability,
reproducibility, sensitivity to inputs, absence of bias in pattern
selection.

**Expected concerns.**

- "How do you know your thresholds don't generate mass false
  positives?" → Continuous calibration (W-14 + W-16); quarterly ECE
  measurement; public dashboard.
- "Can you reproduce a dossier?" → Yes: frozen inputs, versioned
  parameters, posterior recomputable. Reproducibility tested on
  every release.
- "Who audits the platform itself?" → The council; the TAL-PA
  subsystem records every platform action and anchors publicly on
  Polygon.
- "What if I detect a methodological error?" → You vote no, you put
  it in the minutes. The council does not release a dossier you
  reject.

**Closing.**

> "Thank you. Brief by email within 48 hours. Decide in your own
> time."
