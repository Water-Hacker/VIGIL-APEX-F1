import QRCode from 'qrcode';

/**
 * Deterministic QR code generation. Output is PNG bytes; caller embeds.
 *
 * Determinism: qrcode 1.5+ is deterministic for identical input + version.
 */
export async function generateQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 256,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}
