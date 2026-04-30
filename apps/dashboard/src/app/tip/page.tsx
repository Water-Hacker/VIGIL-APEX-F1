'use client';

import { TipSanitise } from '@vigil/shared';
import Script from 'next/script';
import { useCallback, useEffect, useState } from 'react';

import { TipAttachmentPicker } from './attachment-picker';

/**
 * /tip — anonymous tip portal. SRD §28 + DECISION-016 hardening.
 *
 * Flow:
 *   1. Page mount: fetch the operator-team public key (rotated periodically).
 *   2. Citizen types body text + optional contact + selects N attachments.
 *   3. Attachments are sanitised in-browser (magic-byte gate, EXIF
 *      strip via canvas re-encode for images), libsodium-sealed-box-
 *      encrypted to the operator key, and uploaded to /api/tip/attachment
 *      which pins them to IPFS and returns a CID. The server NEVER sees
 *      the plaintext attachment.
 *   4. On submit: body + contact are also sealed-box-encrypted in-
 *      browser, then POST'd to /api/tip/submit alongside the
 *      attachment_cids array. The server NEVER sees the plaintext body.
 *
 * Hardening:
 *   - Closed MIME allow-list + magic-byte gate (TipSanitise) — declared
 *     MIME must match the actual bytes; no MIME spoofing.
 *   - Image re-encode (canvas) drops EXIF / ICC / IPTC / steganographic
 *     LSB before encryption.
 *   - 10 MB / file, 40 MB / submission, 5 attachments / submission
 *     (TIP_ATTACHMENT_LIMITS, mirrored on the server).
 *   - Filename sanitisation strips path traversal / control chars /
 *     non-ASCII.
 *   - Body + contact are NFC-normalised, control-char-stripped, ZWJ-
 *     stripped (homoglyph spoofing) BEFORE encryption.
 *   - Strict CSP meta (no inline scripts, no eval, no foreign origins
 *     except Cloudflare Turnstile + IPFS gateway).
 */

declare global {
  interface Window {
    turnstile?: {
      render: (selector: string | HTMLElement, opts: { sitekey: string }) => string;
    };
  }
}

const TURNSTILE_SITEKEY = process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY ?? '0x4AAAAAAAAAAAAAAA';

interface AttachmentRecord {
  cid: string;
  displayName: string;
  mime: TipSanitise.AllowedTipMime;
  bytes: number;
}

export default function TipPage(): JSX.Element {
  const [submitted, setSubmitted] = useState<{ ref: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<ReadonlyArray<AttachmentRecord>>([]);
  const [operatorPk, setOperatorPk] = useState<string | null>(null);
  const [pkErr, setPkErr] = useState<string | null>(null);

  // Fetch operator public key once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/tip/public-key');
        if (!r.ok) throw new Error(`http ${r.status}`);
        const j = (await r.json()) as { publicKey: string };
        if (!cancelled) setOperatorPk(j.publicKey);
      } catch (e) {
        if (!cancelled) setPkErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(
    async (ev: React.FormEvent<HTMLFormElement>): Promise<void> => {
      ev.preventDefault();
      setBusy(true);
      setError(null);
      try {
        if (!operatorPk) {
          throw new Error('operator-public-key-unavailable');
        }
        const fd = new FormData(ev.currentTarget);

        // Browser-side sanitise BEFORE encryption. Server runs the same
        // gates again (defense in depth).
        const bodyVerdict = TipSanitise.sanitiseTextBody(String(fd.get('body') ?? ''));
        if (!bodyVerdict.ok) throw new Error(bodyVerdict.reason);
        const contactVerdict = TipSanitise.sanitiseContact(String(fd.get('contact') ?? ''));
        if (!contactVerdict.ok) throw new Error(contactVerdict.reason);

        const region = String(fd.get('region') ?? '').trim();
        const turnstile = String(fd.get('cf-turnstile-response') ?? '');

        const sodium = await import('libsodium-wrappers-sumo');
        await sodium.default.ready;
        const pk = sodium.default.from_base64(operatorPk, sodium.default.base64_variants.ORIGINAL);
        const bodyCt = sodium.default.crypto_box_seal(
          sodium.default.from_string(bodyVerdict.value),
          pk,
        );
        const contactCt =
          contactVerdict.value.length > 0
            ? sodium.default.crypto_box_seal(sodium.default.from_string(contactVerdict.value), pk)
            : null;

        const res = await fetch('/api/tip/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body_ciphertext_b64: sodium.default.to_base64(
              bodyCt,
              sodium.default.base64_variants.ORIGINAL,
            ),
            ...(contactCt && {
              contact_ciphertext_b64: sodium.default.to_base64(
                contactCt,
                sodium.default.base64_variants.ORIGINAL,
              ),
            }),
            region: region || undefined,
            attachment_cids: attachments.map((a) => a.cid),
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
    },
    [operatorPk, attachments],
  );

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
          Aucune information identifiante n&rsquo;a été conservée. Le contenu est chiffré et ne peut
          être déchiffré qu&rsquo;avec la cérémonie de quorum 3-sur-5 du conseil. Les pièces jointes
          ont été ré-encodées dans votre navigateur (suppression des métadonnées EXIF) avant
          chiffrement.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Signalement anonyme — VIGIL APEX</h1>
      <p style={{ color: 'var(--muted)' }}>
        Votre signalement (texte + pièces jointes) est chiffré dans votre navigateur avant tout
        envoi. Notre serveur ne voit jamais le contenu en clair. Pour la sécurité maximale,
        soumettez depuis Tor Browser sur un réseau Wi-Fi public.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="body">Description (français ou anglais) :</label>
        <textarea
          id="body"
          name="body"
          rows={10}
          required
          minLength={TipSanitise.TIP_ATTACHMENT_LIMITS.minBodyChars}
          maxLength={TipSanitise.TIP_ATTACHMENT_LIMITS.maxBodyChars}
          style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
        />

        {operatorPk ? (
          <TipAttachmentPicker
            operatorPublicKeyB64={operatorPk}
            attachments={attachments}
            onChange={setAttachments}
          />
        ) : (
          <p role="status" style={{ color: 'var(--muted)' }}>
            {pkErr
              ? `Clé publique opérateur indisponible: ${pkErr}`
              : 'Chargement de la clé publique chiffrement…'}
          </p>
        )}

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
          maxLength={TipSanitise.TIP_ATTACHMENT_LIMITS.maxContactChars}
          placeholder="Laisser vide pour un signalement strictement anonyme"
        />
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async
          defer
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
        <div
          className="cf-turnstile"
          data-sitekey={TURNSTILE_SITEKEY}
          data-callback="onTurnstileSuccess"
        />
        <button type="submit" disabled={busy || !operatorPk}>
          {busy ? 'Chiffrement…' : 'Soumettre de manière anonyme'}
        </button>
      </form>
      {error ? <p style={{ color: 'var(--error)' }}>Erreur : {error}</p> : null}
      <hr style={{ marginTop: 32 }} />
      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <section lang="fr">
          <h3>Ce que nous garantissons</h3>
          <ul>
            <li>Chiffrement libsodium côté navigateur avant tout envoi</li>
            <li>Aucun journal d&rsquo;adresse IP au-delà de 7 jours (anti-abus uniquement)</li>
            <li>
              Métadonnées EXIF / auteur retirées des images dans votre navigateur (ré-encodage
              canvas)
            </li>
            <li>
              Vérification par signature binaire de chaque pièce jointe — le type MIME déclaré doit
              correspondre aux octets réels (refus du masquage de fichiers exécutables en images)
            </li>
            <li>Déchiffrement uniquement par cérémonie 3-sur-5 du conseil</li>
            <li>Texte paraphrasé avant tout dossier — jamais transmis verbatim</li>
            <li>
              Aucun signalement, une fois reçu, ne peut être supprimé — la conservation est garantie
              par déclencheurs de base de données et un journal de transitions inaltérable
              (DECISION-016)
            </li>
          </ul>
          <h3>Ce que nous NE pouvons pas garantir</h3>
          <ul>
            <li>Protection contre la surveillance de votre FAI au point d&rsquo;envoi</li>
            <li>Protection si le contenu vous identifie auprès du destinataire</li>
            <li>Anonymat absolu face à une enquête déterminée</li>
          </ul>
        </section>
        <section lang="en">
          <h3>What we guarantee</h3>
          <ul>
            <li>Browser-side libsodium encryption before any network send</li>
            <li>No IP-address log beyond 7 days (anti-abuse only)</li>
            <li>EXIF / author metadata stripped from images in your browser (canvas re-encode)</li>
            <li>
              Magic-byte verification of every attachment — declared MIME must match the actual
              bytes (executable-as-image masking refused)
            </li>
            <li>Decryption requires a 3-of-5 council quorum ceremony</li>
            <li>Tip text is paraphrased before any dossier — never carried verbatim</li>
            <li>
              No tip, once received, can be deleted — retention is enforced by database triggers and
              an append-only transition log (DECISION-016)
            </li>
          </ul>
          <h3>What we cannot guarantee</h3>
          <ul>
            <li>Protection against ISP-level surveillance at your endpoint</li>
            <li>Protection if the content itself identifies you to the recipient</li>
            <li>Absolute anonymity against a determined investigation</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
