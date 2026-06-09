import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { passwordResetEmail } from './templates/password-reset.template';

/** Default branding values; override via env (MAIL_FROM_NAME, MAIL_LOGO_URL). */
const DEFAULT_FROM_NAME = 'Foodies';
const DEFAULT_LOGO_URL = 'https://foodies-pakistan.com/foodies-logo.png';
const DEFAULT_WEBSITE_URL = 'https://foodies-pakistan.com';
const APP_STORE_URL =
    'https://apps.apple.com/us/app/foodies-pakistan/id6769331907';
const PLAY_STORE_URL =
    'https://play.google.com/store/apps/details?id=com.rex.technologies.foodiespk';
const OTP_EXPIRY_MINUTES = 15;

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private transporter: Transporter | null = null;

    constructor(private config: ConfigService) {
        const host = this.config.get<string>('MAIL_HOST');
        const port = this.config.get<string>('MAIL_PORT');
        const user = this.config.get<string>('MAIL_USER');
        const pass = this.config.get<string>('MAIL_PASSWORD');

        if (host && user && pass) {
            let portNum = port ? parseInt(port, 10) : 2525;
            if (
                host.includes('mailtrap') &&
                ![25, 465, 587, 2525].includes(portNum)
            ) {
                this.logger.warn(
                    `Mailtrap requires port 25, 465, 587 or 2525; using 2525 instead of ${portNum}`,
                );
                portNum = 2525;
            }
            const secure = this.config.get<string>('MAIL_SECURE') === 'true';
            this.transporter = nodemailer.createTransport({
                host,
                port: portNum,
                secure,
                auth: { user, pass },
                ...(portNum === 2525 && !secure
                    ? { tls: { rejectUnauthorized: false } }
                    : {}),
            });
            this.logger.log(`Mail transporter configured (${host}:${portNum})`);
        } else {
            this.logger.warn(
                'Mail not configured (set MAIL_HOST, MAIL_USER, MAIL_PASSWORD in .env). OTP will be logged to console only.',
            );
        }
    }

    /**
     * Send password-reset OTP to the given email.
     * If SMTP is not configured, logs the OTP to console (for development).
     */
    async sendPasswordResetOtp(to: string, code: string): Promise<void> {
        const from =
            this.config.get<string>('MAIL_FROM') ||
            this.config.get<string>('MAIL_USER') ||
            'noreply@rough-foodie.local';
        const fromName =
            this.config.get<string>('MAIL_FROM_NAME') || DEFAULT_FROM_NAME;
        const logoUrl =
            this.config.get<string>('MAIL_LOGO_URL') || DEFAULT_LOGO_URL;
        const websiteUrl =
            this.config.get<string>('MAIL_WEBSITE_URL') || DEFAULT_WEBSITE_URL;
        const subject = 'Your password reset code';
        const { html, text } = passwordResetEmail({
            code,
            expiresMinutes: OTP_EXPIRY_MINUTES,
            logoUrl,
            appStoreUrl: APP_STORE_URL,
            playStoreUrl: PLAY_STORE_URL,
            websiteUrl,
        });

        if (this.transporter) {
            try {
                await this.transporter.sendMail({
                    from: `"${fromName}" <${from}>`,
                    to,
                    subject,
                    text,
                    html,
                });
                this.logger.log(`Password reset email sent to ${to}`);
            } catch (err) {
                this.logger.error(
                    `Failed to send password reset email to ${to}: ${err instanceof Error ? err.message : String(err)}`,
                );
                if (err instanceof Error && err.stack) {
                    this.logger.debug(err.stack);
                }
                throw err;
            }
        } else {
            this.logger.warn(
                `[DEV] Mail not configured. Password reset OTP for ${to}: ${code}`,
            );
        }
    }
}
