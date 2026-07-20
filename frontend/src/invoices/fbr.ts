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
 * PLACEHOLDER for the official FBR "POS Invoicing" logo — the client supplies
 * the real artwork. To swap it in: convert the provided file to a data URI
 * (SVG preferred, else PNG ≥200px wide for thermal print) and replace this
 * constant. Nothing else references the artwork.
 */
export const FBR_LOGO_SRC =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 56">` +
      `<rect x="1" y="1" width="118" height="54" rx="6" fill="none" stroke="#000" stroke-width="2"/>` +
      `<text x="60" y="24" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="bold" fill="#000">FBR</text>` +
      `<text x="60" y="42" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#000">POS Invoicing</text>` +
    `</svg>`,
  );
