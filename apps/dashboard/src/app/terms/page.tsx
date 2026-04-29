import { getLocale, loadMessages } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

export default async function TermsPage(): Promise<JSX.Element> {
  const locale = getLocale();
  await loadMessages(locale);

  if (locale === 'en') {
    return (
      <main className="mx-auto max-w-3xl p-6 prose">
        <h1>Terms of use</h1>
        <p>
          Use of vigilapex.cm and its sub-surfaces (verify, tip, operator,
          council) is governed by these terms and by the v5.1 commercial
          agreement of 2026 between VIGIL APEX SAS and the Republic of
          Cameroon.
        </p>
        <h2>Permitted use</h2>
        <ul>
          <li>
            Public consultation of the verify and ledger surfaces.
          </li>
          <li>
            Submission of tips at /tip — submitters retain ownership of
            their content; we hold ciphertext.
          </li>
          <li>
            Operator and council use under explicit credentials, governed
            by an internal Code of Conduct (separate document, archived
            with each council member).
          </li>
        </ul>
        <h2>Prohibited</h2>
        <ul>
          <li>
            Automated scraping that interferes with platform availability.
          </li>
          <li>
            Use of platform output to harass, defame or threaten any
            person. Findings before council vote are NOT public; sharing
            them prematurely violates Article 4 of the agreement.
          </li>
          <li>
            Reverse-engineering of pattern detectors with intent to evade.
          </li>
        </ul>
        <h2>Liability</h2>
        <p>
          The platform produces probabilistic findings (Bayesian posteriors)
          calibrated for ECE &lt; 5%. A finding is a hypothesis backed by
          cited evidence — not a judicial ruling. The Republic of Cameroon
          retains final adjudicatory authority through CONAC and the courts.
        </p>
        <h2>Disputes</h2>
        <p>
          Governed by the v5.1 commercial agreement §15. Cameroonian
          jurisdiction applies. Out-of-scope private disputes are not
          addressed by VIGIL APEX SAS.
        </p>
        <p>
          <em>Last updated: 2026-04-28.</em>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6 prose" lang="fr">
      <h1>Conditions d&apos;utilisation</h1>
      <p>
        L&apos;utilisation de vigilapex.cm et de ses sous-domaines (verify,
        tip, opérateur, conseil) est régie par les présentes conditions et
        par l&apos;accord commercial v5.1 de 2026 entre VIGIL APEX SAS et la
        République du Cameroun.
      </p>
      <h2>Utilisation autorisée</h2>
      <ul>
        <li>Consultation publique des surfaces verify et registre.</li>
        <li>
          Soumission de signalements via /tip — les signaleurs conservent la
          propriété de leur contenu ; nous ne détenons que le texte chiffré.
        </li>
        <li>
          Utilisation opérateur et conseil sous identifiants explicites,
          régie par un Code de Conduite interne (document séparé, archivé
          chez chaque membre du conseil).
        </li>
      </ul>
      <h2>Interdit</h2>
      <ul>
        <li>
          Le scraping automatisé qui dégrade la disponibilité de la
          plateforme.
        </li>
        <li>
          L&apos;utilisation des résultats pour harceler, diffamer ou
          menacer une personne. Les constats avant vote du conseil ne sont
          pas publics ; les partager prématurément viole l&apos;article 4
          de l&apos;accord.
        </li>
        <li>
          La rétro-ingénierie des détecteurs de patrons en vue
          d&apos;évasion.
        </li>
      </ul>
      <h2>Responsabilité</h2>
      <p>
        La plateforme produit des constats probabilistes (postérieurs
        bayésiens) calibrés pour ECE &lt; 5%. Un constat est une hypothèse
        appuyée par des preuves citées — non un verdict judiciaire. La
        République du Cameroun conserve l&apos;autorité décisionnelle finale
        via la CONAC et les tribunaux.
      </p>
      <h2>Litiges</h2>
      <p>
        Régis par l&apos;accord commercial v5.1 §15. Juridiction
        camerounaise applicable. Les litiges privés hors champ ne sont pas
        traités par VIGIL APEX SAS.
      </p>
      <p>
        <em>Dernière mise à jour&nbsp;: 2026-04-28.</em>
      </p>
    </main>
  );
}
