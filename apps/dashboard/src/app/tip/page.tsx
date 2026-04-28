'use client';

import { useState } from 'react';

/**
 * /tip — anonymous tip portal. SRD §28.
 *
 * Client-side libsodium sealed-box encryption to operator-team public key
 * happens in `submit()` BEFORE network call. The server NEVER sees plaintext.
 *
 * W-09: this page is also served at <onion>/tip; the only difference is the
 * Cloudflare Turnstile is replaced by a hashcash proof on the .onion variant.
 */

export default function TipPage(): JSX.Element {
  const [submitted, setSubmitted] = useState<{ ref: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent<HTMLFormElement>): Promise<void> {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData(ev.currentTarget);
      const body = String(fd.get('body') ?? '').trim();
      const contact = String(fd.get('contact') ?? '').trim();
      const region = String(fd.get('region') ?? '');
      const turnstile = String(fd.get('cf-turnstile-response') ?? '');

      // Fetch operator team public key (rotated periodically)
      const pkRes = await fetch('/api/tip/public-key');
      const { publicKey } = (await pkRes.json()) as { publicKey: string };

      // libsodium sealed-box (browser bundle) — see /tip-encrypt.js loader
      const sodium = await import('libsodium-wrappers-sumo');
      await sodium.default.ready;
      const pk = sodium.default.from_base64(publicKey, sodium.default.base64_variants.ORIGINAL);
      const bodyCt = sodium.default.crypto_box_seal(sodium.default.from_string(body), pk);
      const contactCt = contact
        ? sodium.default.crypto_box_seal(sodium.default.from_string(contact), pk)
        : null;

      const res = await fetch('/api/tip/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_ciphertext_b64: sodium.default.to_base64(bodyCt, sodium.default.base64_variants.ORIGINAL),
          ...(contactCt && {
            contact_ciphertext_b64: sodium.default.to_base64(contactCt, sodium.default.base64_variants.ORIGINAL),
          }),
          region: region || undefined,
          turnstile_token: turnstile,
        }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { ref: string };
      setSubmitted(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <main>
        <h1>Merci. Votre signalement est reçu.</h1>
        <p>
          Référence : <code>{submitted.ref}</code>
          <br />
          Vous pouvez consulter le statut à : <code>/tip/status?ref={submitted.ref}</code>
        </p>
        <p>
          Aucune information identifiante n’a été conservée. Le contenu est chiffré et ne peut
          être déchiffré qu’avec la cérémonie de quorum 3-sur-5 du conseil.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Signalement anonyme — VIGIL APEX</h1>
      <p style={{ color: 'var(--muted)' }}>
        Votre signalement est chiffré dans votre navigateur avant tout envoi. Notre serveur ne voit
        jamais le texte clair. Pour la sécurité maximale, soumettez depuis Tor Browser sur un
        réseau Wi-Fi public.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="body">
          Description (français ou anglais) :
        </label>
        <textarea
          id="body"
          name="body"
          rows={10}
          required
          minLength={50}
          maxLength={5000}
          style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
        />
        <label htmlFor="region">Région concernée :</label>
        <select id="region" name="region">
          <option value="">— Aucune préférence —</option>
          <option value="CE">Centre</option>
          <option value="LT">Littoral</option>
          <option value="NW">Nord-Ouest</option>
          <option value="SW">Sud-Ouest</option>
          <option value="OU">Ouest</option>
          <option value="SU">Sud</option>
          <option value="ES">Est</option>
          <option value="EN">Extrême-Nord</option>
          <option value="NO">Nord</option>
          <option value="AD">Adamaoua</option>
        </select>
        <label htmlFor="contact">Contact optionnel (email Proton, Signal, etc.) :</label>
        <input
          id="contact"
          name="contact"
          type="text"
          maxLength={200}
          placeholder="Laisser vide pour un signalement strictement anonyme"
        />
        <div className="cf-turnstile" data-sitekey="0x4AAAAAAAAAAAAAAA" data-callback="onTurnstileSuccess" />
        <button type="submit" disabled={busy}>
          {busy ? 'Chiffrement…' : 'Soumettre de manière anonyme'}
        </button>
      </form>
      {error ? <p style={{ color: 'var(--error)' }}>Erreur : {error}</p> : null}
      <hr style={{ marginTop: 32 }} />
      <h3>Ce que nous garantissons</h3>
      <ul>
        <li>Chiffrement libsodium côté navigateur avant tout envoi</li>
        <li>Aucun journal d’adresse IP au-delà de 7 jours (anti-abus uniquement)</li>
        <li>Métadonnées EXIF / auteur retirées des pièces jointes</li>
        <li>Déchiffrement uniquement par cérémonie 3-sur-5 du conseil</li>
        <li>Texte du signalement paraphrasé avant tout dossier — jamais transmis verbatim</li>
      </ul>
      <h3>Ce que nous NE pouvons pas garantir</h3>
      <ul>
        <li>Protection contre la surveillance de votre FAI au point d’envoi</li>
        <li>Protection si le contenu vous identifie auprès du destinataire</li>
        <li>Anonymat absolu face à une enquête déterminée</li>
      </ul>
    </main>
  );
}
