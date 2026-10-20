import QRCode from 'qrcode';

/** Local PNG encoder. Callers supply and validate the destination themselves. */
export async function createInvitationQr(url: string): Promise<string> {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid QR URL');
  return QRCode.toDataURL(url, {
    type: 'image/png', width: 512, margin: 4, errorCorrectionLevel: 'M',
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
}
