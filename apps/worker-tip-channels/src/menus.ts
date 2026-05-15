/**
 * Channel menu prompts in declared languages.
 *
 * FR + EN are production-ready (mirror the browser portal copy).
 * The four Cameroonian-language slots (ful / ewo / dua / bbj / cpe)
 * are placeholders pending counsel + native-speaker review of:
 *   - Privacy / consent language (must be legally equivalent to FR)
 *   - Anonymity claim phrasing (must not imply false guarantees)
 *   - Cultural appropriateness of the threat framing
 *
 * The architect's M-3 institutional milestone (council enrolment)
 * is the natural unlock for the translation work — the civil-society
 * pillar is the right curator for native-speaker review.
 *
 * DO NOT translate this file via LLM unaided. Use it as a placeholder
 * that the translation team replaces before USSD goes live.
 */

import type { TipLanguage } from './tip-channels.js';

export interface MenuPromptSet {
  readonly welcome: string;
  readonly anonymity_assurance: string;
  readonly enter_observation: string;
  readonly confirm_submit: string;
  readonly submitted_with_ref: (ref: string) => string;
  readonly submitted_failed: string;
}

const FR_MENU: MenuPromptSet = {
  welcome:
    'VIGIL APEX — plateforme publique de signalement anonyme. Aucune donnée personnelle requise.',
  anonymity_assurance:
    "Votre signalement est chiffré sur votre appareil avant transmission. Personne — y compris l'opérateur — ne peut le lire sans quorum de 3 piliers du conseil.",
  enter_observation:
    'Décrivez votre observation. Maximum 1000 caractères. Pas de noms, juste les faits.',
  confirm_submit: 'Envoyer ? 1 = Oui, 2 = Annuler',
  submitted_with_ref: (ref) =>
    `Signalement reçu. Référence : ${ref}. Vous pouvez consulter le statut sur le site public.`,
  submitted_failed:
    "Échec de la transmission. Réessayez plus tard. Aucune donnée n'a été conservée.",
};

const EN_MENU: MenuPromptSet = {
  welcome: 'VIGIL APEX — public anonymous reporting platform. No personal data required.',
  anonymity_assurance:
    'Your tip is encrypted on your device before transmission. Nobody — including the operator — can read it without a 3-pillar council quorum.',
  enter_observation:
    'Describe what you observed. Maximum 1000 characters. No names, just the facts.',
  confirm_submit: 'Submit? 1 = Yes, 2 = Cancel',
  submitted_with_ref: (ref) =>
    `Tip received. Reference: ${ref}. You can check the status on the public website.`,
  submitted_failed: 'Submission failed. Try again later. No data was retained.',
};

// Placeholders — to be replaced by counsel-reviewed translations
// before USSD/SMS goes live to the population that needs them.
const PLACEHOLDER_PREFIX = '[FR primary; translation pending civil-society pillar review] ';

const FUL_MENU: MenuPromptSet = withPrefix(PLACEHOLDER_PREFIX, FR_MENU);
const EWO_MENU: MenuPromptSet = withPrefix(PLACEHOLDER_PREFIX, FR_MENU);
const DUA_MENU: MenuPromptSet = withPrefix(PLACEHOLDER_PREFIX, FR_MENU);
const BBJ_MENU: MenuPromptSet = withPrefix(PLACEHOLDER_PREFIX, FR_MENU);
const CPE_MENU: MenuPromptSet = withPrefix(PLACEHOLDER_PREFIX, EN_MENU);

function withPrefix(prefix: string, base: MenuPromptSet): MenuPromptSet {
  return {
    welcome: prefix + base.welcome,
    anonymity_assurance: prefix + base.anonymity_assurance,
    enter_observation: prefix + base.enter_observation,
    confirm_submit: prefix + base.confirm_submit,
    submitted_with_ref: (ref) => prefix + base.submitted_with_ref(ref),
    submitted_failed: prefix + base.submitted_failed,
  };
}

const MENU_BY_LANGUAGE: Readonly<Record<TipLanguage, MenuPromptSet>> = {
  fr: FR_MENU,
  en: EN_MENU,
  ful: FUL_MENU,
  ewo: EWO_MENU,
  dua: DUA_MENU,
  bbj: BBJ_MENU,
  cpe: CPE_MENU,
};

export function menuFor(language: TipLanguage): MenuPromptSet {
  return MENU_BY_LANGUAGE[language] ?? FR_MENU;
}

export function isLanguageProductionReady(language: TipLanguage): boolean {
  return language === 'fr' || language === 'en';
}
