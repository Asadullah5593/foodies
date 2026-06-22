/**
 * Password-reset OTP email template (HTML + plain-text).
 *
 * Built as a plain string helper (no templating engine) to match the rest of
 * the codebase. Layout is table-based with inline CSS for broad email-client
 * compatibility (Gmail, Outlook, Apple Mail). The logo is referenced by a
 * public HTTPS URL — email clients do not render SVG, so a PNG is used.
 */

const BRAND_RED = '#dc2626';

export interface PasswordResetTemplateOptions {
    /** The 6-digit OTP code to display. */
    code: string;
    /** How long the code is valid, in minutes. */
    expiresMinutes: number;
    /** Public HTTPS URL of the Foodies logo (PNG). */
    logoUrl: string;
    /** iOS App Store listing URL. */
    appStoreUrl: string;
    /** Google Play listing URL. */
    playStoreUrl: string;
    /** Marketing/website URL shown in the footer. */
    websiteUrl: string;
}

export interface RenderedEmail {
    html: string;
    text: string;
}

export function passwordResetEmail(
    opts: PasswordResetTemplateOptions,
): RenderedEmail {
    const {
        code,
        expiresMinutes,
        logoUrl,
        appStoreUrl,
        playStoreUrl,
        websiteUrl,
    } = opts;
    const year = new Date().getFullYear();

    const text = [
        'Foodies — Reset your password',
        '',
        "Hi! Here's your verification code to get back into your account:",
        '',
        `    ${code}`,
        '',
        `Valid for ${expiresMinutes} minutes. If this wasn't you, just ignore this email.`,
        '',
        'Thanks,',
        'The Foodies Team',
        '',
        'Get the Foodies app:',
        `  App Store:   ${appStoreUrl}`,
        `  Google Play: ${playStoreUrl}`,
        '',
        `© ${year} Foodies Pakistan • ${websiteUrl}`,
    ].join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Foodies — Password reset</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5; padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,0.06);">

          <tr>
            <td style="padding:28px 40px 0 40px;" align="left">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:12px;" valign="middle">
                    <img src="${logoUrl}" width="40" height="40" alt="Foodies" style="display:block; border-radius:50%;">
                  </td>
                  <td valign="middle">
                    <span style="color:${BRAND_RED}; font-size:20px; font-weight:700;">Foodies</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 40px 0 40px;">
              <h1 style="margin:0 0 10px 0; color:#111113; font-size:22px; font-weight:700;">Reset your password</h1>
              <div style="width:48px; height:3px; background-color:${BRAND_RED}; border-radius:3px;"></div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 40px 0 40px;">
              <p style="margin:0; color:#52525b; font-size:15px; line-height:23px;">Hi! Here's your verification code to get back into your account:</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:26px 40px 8px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color:${BRAND_RED}; border-radius:40px; padding:16px 44px;">
                    <span style="color:#ffffff; font-size:30px; font-weight:700; letter-spacing:8px;">${code}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 40px 0 40px;">
              <p style="margin:0 0 6px 0; color:#52525b; font-size:14px; line-height:21px;">Valid for <strong style="color:#111113;">${expiresMinutes} minutes</strong>. If this wasn't you, just ignore this email.</p>
              <p style="margin:22px 0 28px 0; color:#111113; font-size:14px;">Thanks,<br><strong>The Foodies Team</strong></p>
            </td>
          </tr>

          <tr>
            <td style="background-color:#111113; padding:26px 40px;" align="center">
              <p style="margin:0 0 14px 0; color:#ffffff; font-size:14px; font-weight:600;">Get the Foodies app</p>
              <p style="margin:0 0 16px 0;">
                <a href="${appStoreUrl}" style="display:inline-block; color:#ffffff; font-size:12px; text-decoration:none; border:1px solid #52525b; border-radius:8px; padding:8px 16px; margin:0 5px;">App Store</a>
                <a href="${playStoreUrl}" style="display:inline-block; color:#ffffff; font-size:12px; text-decoration:none; border:1px solid #52525b; border-radius:8px; padding:8px 16px; margin:0 5px;">Google Play</a>
              </p>
              <p style="margin:0; color:#8a8a93; font-size:11px;">&copy; ${year} Foodies Pakistan &bull; <a href="${websiteUrl}" style="color:#8a8a93;">foodies-pakistan.com</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    return { html, text };
}
