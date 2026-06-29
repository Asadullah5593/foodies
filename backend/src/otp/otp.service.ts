import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { OtpCode } from '../entities/otp-code.entity';
import { normalizePakistaniPhone } from '../utils/phone';

@Injectable()
export class OtpService {
    constructor(
        @InjectRepository(OtpCode) private repo: Repository<OtpCode>,
        private config: ConfigService,
    ) {}

    /** Generate a 6-digit numeric OTP code. */
    private generateCode(): string {
        const n = Math.floor(Math.random() * 900000) + 100000;
        return String(n);
    }

    /** OTP lifetime in ms (OTP_EXPIRY_MINUTES, default 15). */
    private get expiryMs(): number {
        const m = parseInt(
            this.config.get<string>('OTP_EXPIRY_MINUTES') || '',
            10,
        );
        return (Number.isFinite(m) && m > 0 ? m : 15) * 60 * 1000;
    }

    /** Minimum gap between resends for a given identifier (OTP_RESEND_COOLDOWN_SECONDS, default 60). */
    private get resendCooldownMs(): number {
        const s = parseInt(
            this.config.get<string>('OTP_RESEND_COOLDOWN_SECONDS') || '',
            10,
        );
        return (Number.isFinite(s) && s >= 0 ? s : 60) * 1000;
    }

    private normalizePhoneOrThrow(phone: string): string {
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) {
            throw new BadRequestException(
                'Invalid Pakistani phone number. Use format: 03XXXXXXXXX (e.g. 03001234567)',
            );
        }
        return normalized;
    }

    // —— Email OTP (password reset) ——

    /** Create OTP for email (e.g. password_reset). */
    async create(
        email: string,
        purpose: string = 'password_reset',
    ): Promise<{ code: string; expiresAt: Date }> {
        const trimmed =
            typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!trimmed) throw new BadRequestException('Email is required');
        const code = this.generateCode();
        const expiresAt = new Date(Date.now() + this.expiryMs);
        await this.repo.save(
            this.repo.create({
                email: trimmed,
                code,
                purpose,
                expiresAt,
            }),
        );
        return { code, expiresAt };
    }

    /** Find valid OTP by email and code (not expired, not used). */
    async findValid(
        email: string,
        code: string,
        purpose: string = 'password_reset',
    ): Promise<OtpCode | null> {
        const trimmed =
            typeof email === 'string' ? email.trim().toLowerCase() : '';
        const codeTrim = typeof code === 'string' ? code.trim() : '';
        if (!trimmed || !codeTrim) return null;
        const row = await this.repo.findOne({
            where: { email: trimmed, code: codeTrim, purpose },
            order: { id: 'DESC' },
        });
        if (!row || row.usedAt || new Date() > row.expiresAt) return null;
        return row;
    }

    /** Verify email OTP and mark as used. Returns the OTP record. */
    async verifyAndUse(
        email: string,
        code: string,
        purpose: string = 'password_reset',
    ): Promise<OtpCode> {
        const otp = await this.findValid(email, code, purpose);
        if (!otp) throw new BadRequestException('Invalid or expired OTP');
        otp.usedAt = new Date();
        await this.repo.save(otp);
        return otp;
    }

    // —— Phone OTP (SMS: phone_verification, password_reset) ——

    /**
     * Create an OTP for a phone number. Enforces a resend cooldown per
     * (phone, purpose) so the SMS endpoint can't be spammed.
     */
    async createForPhone(
        phone: string,
        purpose: string,
    ): Promise<{ code: string; expiresAt: Date }> {
        const normalized = this.normalizePhoneOrThrow(phone);
        const cooldown = this.resendCooldownMs;
        if (cooldown > 0) {
            const last = await this.repo.findOne({
                where: { phone: normalized, purpose },
                order: { id: 'DESC' },
            });
            if (
                last &&
                Date.now() - new Date(last.createdAt).getTime() < cooldown
            ) {
                throw new BadRequestException(
                    'Please wait before requesting another code',
                );
            }
        }
        const code = this.generateCode();
        const expiresAt = new Date(Date.now() + this.expiryMs);
        await this.repo.save(
            this.repo.create({ phone: normalized, code, purpose, expiresAt }),
        );
        return { code, expiresAt };
    }

    /** Find valid phone OTP by code (not expired, not used). */
    async findValidForPhone(
        phone: string,
        code: string,
        purpose: string,
    ): Promise<OtpCode | null> {
        const normalized = normalizePakistaniPhone(phone);
        const codeTrim = typeof code === 'string' ? code.trim() : '';
        if (!normalized || !codeTrim) return null;
        const row = await this.repo.findOne({
            where: { phone: normalized, code: codeTrim, purpose },
            order: { id: 'DESC' },
        });
        if (!row || row.usedAt || new Date() > row.expiresAt) return null;
        return row;
    }

    /** Verify phone OTP and mark as used (single-use). */
    async verifyForPhone(
        phone: string,
        code: string,
        purpose: string,
    ): Promise<OtpCode> {
        const otp = await this.findValidForPhone(phone, code, purpose);
        if (!otp) throw new BadRequestException('Invalid or expired OTP');
        otp.usedAt = new Date();
        await this.repo.save(otp);
        return otp;
    }

    /**
     * True if a phone OTP for the given purpose was verified (marked used)
     * within `withinMs`. Lets register trust a just-completed verification.
     */
    async wasRecentlyVerified(
        phone: string,
        purpose: string,
        withinMs: number,
    ): Promise<boolean> {
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) return false;
        const row = await this.repo.findOne({
            where: { phone: normalized, purpose, usedAt: Not(IsNull()) },
            order: { id: 'DESC' },
        });
        if (!row || !row.usedAt) return false;
        return Date.now() - new Date(row.usedAt).getTime() <= withinMs;
    }
}
