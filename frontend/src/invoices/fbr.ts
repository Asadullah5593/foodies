import qrcode from 'qrcode-generator';

/**
 * FBR fiscalization assets for the printed receipt.
 *
 * The QR is generated per invoice — it encodes the FBR fiscal invoice number
 * so customers can verify the receipt in FBR's Tax Asaan app. Rendered as an
 * inline scalable SVG (no canvas / external assets) so it prints crisply from
 * the popup print window at any thermal width.
 */
export function fbrQrSvg(value: string): string {
  // Type 0 = auto-size to the payload; M error correction matches common
  // receipt-QR practice (survives thermal print noise, keeps modules big).
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  return qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
}

/**
 * Default tax-authority logo for the FBR block: the PRA (Punjab Revenue
 * Authority) mark bundled at public/PRA.jpg. Returned as an ABSOLUTE URL so it
 * loads inside the print popup (which has no base URL — relative paths fail
 * there, same reason the app QR is inlined and brand logos use absolute URLs).
 * A template may override this via config.fbrLogoUrl.
 */
export function defaultFbrLogoUrl(): string {
  const origin = typeof window !== 'undefined' ? (window.location?.origin ?? '') : '';
  return `${origin}/PRA.jpg`;
}

/** The logo the FBR block should print: the template's own, else the default. */
export function fbrLogoSrc(customUrl?: string | null): string {
  const trimmed = customUrl?.trim();
  return trimmed ? trimmed : defaultFbrLogoUrl();
}
