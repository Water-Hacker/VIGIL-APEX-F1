import { getLocale, loadMessages } from '../../lib/i18n.js';

export const dynamic = 'force-dynamic';

const ANTIC_DECLARATION_URL =
  process.env.NEXT_PUBLIC_ANTIC_DECLARATION_URL ?? '#antic-declaration-pending';

export default async function PrivacyPage(): Promise<JSX.Element> {
  const locale = getLocale();
  await loadMessages(locale);

  if (locale === 'en') {
    return (
      <main className="mx-auto max-w-3xl p-6 prose">
        <h1>Privacy notice</h1>
        <p>
          VIGIL APEX is operated by VIGIL APEX SAS for the Republic of Cameroon
          under the v5.1 commercial agreement of 2026. This notice describes
          what data the platform collects, how it is processed, and the rights
          of citizens whose information appears in our findings.
        </p>
        <h2>Data we collect</h2>
        <ul>
          <li>
            <strong>Public-data only.</strong> Procurement awards (ARMP), tax
            registry entries (DGGI), corporate filings (RCCM), audit reports
            (Cour des Comptes), gazette publications, and equivalents are
            crawled from official government surfaces. We do NOT exfiltrate
            non-public information.
          </li>
          <li>
            <strong>Encrypted citizen tips.</strong> Submitted via the secure
            tip portal and decrypted only after a 3-of-5 council quorum
            ceremony. Plaintext is never stored.
          </li>
          <li>
            <strong>Minimal access logs.</strong> IP addresses on tip portal
            submissions are kept for at most 7 days for anti-abuse, then
            irreversibly purged. Operator dashboard access is logged for
            audit purposes per Articles 30–35 of the 2010 cybersecurity law.
          </li>
        </ul>
        <h2>Lawful basis</h2>
        <p>
          We operate under (a) the public interest in fighting public-finance
          corruption, (b) explicit consent for tip submitters, and (c) the
          v5.1 commercial agreement. ANTIC declaration:{' '}
          <a href={ANTIC_DECLARATION_URL}>{ANTIC_DECLARATION_URL}</a>.
        </p>
        <h2>Your rights</h2>
        <ul>
          <li>
            <strong>Right to be informed:</strong> any natural person named in
            a published dossier can request a copy of the audit chain entries
            referencing them via{' '}
            <a href="mailto:dpo@vigilapex.cm">dpo@vigilapex.cm</a>.
          </li>
          <li>
            <strong>Right to rectification:</strong> factual errors in source
            data are corrected within 14 days of substantiated request.
          </li>
          <li>
            <strong>Right to lodge a complaint:</strong> via ANTIC.
          </li>
        </ul>
        <h2>Data location</h2>
        <p>
          All data is stored on infrastructure physically located in Cameroon
          (sovereignty by design — SRD §3). Cross-border transfer is limited
          to (i) Polygon mainnet anchors (cryptographic root only, never
          plaintext) and (ii) explicit institutional partners under the v5.1
          agreement.
        </p>
        <h2>Retention</h2>
        <p>
          Public-source events: indefinite. Citizen tips: until council
          disposition + 1 year. Operator audit logs: 7 years per the 2010
          cybersecurity law. Tip portal IP logs: 7 days.
        </p>
        <p>
          <em>
            Last updated: 2026-04-28. Questions:{' '}
            <a href="mailto:dpo@vigilapex.cm">dpo@vigilapex.cm</a>.
          </em>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6 prose" lang="fr">
      <h1>Avis de confidentialité</h1>
      <p>
        VIGIL APEX est exploité par VIGIL APEX SAS pour la République du
        Cameroun en application de l&apos;accord commercial v5.1 de 2026. Le
        présent avis décrit les données que la plateforme recueille, la manière
        dont elles sont traitées et les droits des citoyens dont les
        informations apparaissent dans nos constats.
      </p>
      <h2>Données collectées</h2>
      <ul>
        <li>
          <strong>Uniquement des données publiques.</strong> Marchés
          publics (ARMP), inscriptions au registre fiscal (DGGI), publications
          au RCCM, rapports d&apos;audit (Cour des Comptes), publications au
          Journal Officiel et équivalents sont collectés sur les surfaces
          officielles. Nous ne soustrayons pas d&apos;informations non
          publiques.
        </li>
        <li>
          <strong>Signalements citoyens chiffrés.</strong> Soumis via le
          portail sécurisé et déchiffrés uniquement après cérémonie de
          quorum 3-sur-5 du conseil. Le texte clair n&apos;est jamais stocké.
        </li>
        <li>
          <strong>Journaux d&apos;accès minimaux.</strong> Les adresses IP
          des signalements ne sont conservées que pour 7 jours
          (anti-abus), puis effacées de manière irréversible.
        </li>
      </ul>
      <h2>Base légale</h2>
      <p>
        Nous opérons sur la base (a) de l&apos;intérêt public à lutter contre
        la corruption des finances publiques, (b) du consentement explicite
        des signaleurs et (c) de l&apos;accord commercial v5.1. Déclaration
        ANTIC&nbsp;:{' '}
        <a href={ANTIC_DECLARATION_URL}>{ANTIC_DECLARATION_URL}</a>.
      </p>
      <h2>Vos droits</h2>
      <ul>
        <li>
          <strong>Droit d&apos;information&nbsp;:</strong> toute personne
          physique nommée dans un dossier publié peut demander une copie des
          entrées de la chaîne d&apos;audit la concernant via{' '}
          <a href="mailto:dpo@vigilapex.cm">dpo@vigilapex.cm</a>.
        </li>
        <li>
          <strong>Droit de rectification&nbsp;:</strong> les erreurs
          factuelles dans les sources sont corrigées dans les 14 jours
          suivant la demande étayée.
        </li>
        <li>
          <strong>Droit de plainte&nbsp;:</strong> auprès de l&apos;ANTIC.
        </li>
      </ul>
      <h2>Localisation des données</h2>
      <p>
        Toutes les données sont stockées sur une infrastructure physiquement
        située au Cameroun (souveraineté par conception — SRD §3). Le
        transfert hors-frontière est limité à (i) l&apos;ancrage Polygon
        mainnet (racine cryptographique uniquement, jamais le texte clair) et
        (ii) les partenaires institutionnels explicites prévus par
        l&apos;accord v5.1.
      </p>
      <h2>Conservation</h2>
      <p>
        Événements de sources publiques&nbsp;: indéfinie. Signalements
        citoyens&nbsp;: jusqu&apos;à la disposition du conseil + 1 an.
        Journaux d&apos;audit opérateur&nbsp;: 7 ans selon la loi de
        cybersécurité de 2010. Journaux d&apos;IP du portail&nbsp;: 7 jours.
      </p>
      <p>
        <em>
          Dernière mise à jour&nbsp;: 2026-04-28. Questions&nbsp;:{' '}
          <a href="mailto:dpo@vigilapex.cm">dpo@vigilapex.cm</a>.
        </em>
      </p>
    </main>
  );
}
