import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { OtpCode } from '../entities/otp-code.entity';
import { normalizePakistaniPhone } from '../utils/phone';
import { AdvisoryLock } from '../common/db-concurrency';

@Injectable()
export class OtpService {
    constructor(
        @InjectRepository(OtpCode) private repo: Repository<OtpCode>,
        private config: ConfigService,
        private dataSource: DataSource,
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
        // Atomic single-use claim: only the FIRST concurrent verifier flips used_at,
        // so a code cannot be consumed twice (e.g. a reset-race where two requests
        // submit the same code with different new passwords).
        const res = await this.repo
            .createQueryBuilder()
            .update(OtpCode)
            .set({ usedAt: () => 'now()' })
            .where('id = :id AND used_at IS NULL', { id: otp.id })
            .execute();
        if (res.affected === 0) {
            throw new BadRequestException('Invalid or expired OTP');
        }
        otp.usedAt = new Date();
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
        return this.dataSource.transaction(async (manager) => {
            // Serialize sends per (phone, purpose) so two concurrent requests can't
            // both pass the cooldown check and fire two SMS / mint two live codes.
            await manager.query(
                'SELECT pg_advisory_xact_lock($1, hashtext($2))',
                [AdvisoryLock.OTP_IDENTIFIER, `${normalized}:${purpose}`],
            );
            const cooldown = this.resendCooldownMs;
            if (cooldown > 0) {
                const last = await manager.getRepository(OtpCode).findOne({
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
            await manager.getRepository(OtpCode).save(
                manager.getRepository(OtpCode).create({
                    phone: normalized,
                    code,
                    purpose,
                    expiresAt,
                }),
            );
            return { code, expiresAt };
        });
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

    /** Max failed verify attempts before a phone code is burned (brute-force cap). */
    private static readonly MAX_VERIFY_ATTEMPTS = 5;

    /** Verify phone OTP and mark as used (single-use), with a race-safe brute-force cap. */
    async verifyForPhone(
        phone: string,
        code: string,
        purpose: string,
    ): Promise<OtpCode> {
        const normalized = normalizePakistaniPhone(phone);
        const codeTrim = typeof code === 'string' ? code.trim() : '';
        if (!normalized || !codeTrim) {
            throw new BadRequestException('Invalid or expired OTP');
        }
        // Latest live code for this identifier, independent of the guessed value, so a
        // WRONG guess can still be counted toward the cap.
        const latest = await this.repo.findOne({
            where: { phone: normalized, purpose, usedAt: IsNull() },
            order: { id: 'DESC' },
        });
        if (!latest || new Date() > latest.expiresAt) {
            throw new BadRequestException('Invalid or expired OTP');
        }
        // Atomically count this attempt: concurrent guesses each get a distinct,
        // serialised value, so an attacker cannot outrun the cap by firing in parallel.
        // NOTE: for an UPDATE ... RETURNING, TypeORM's query() returns [rows, count]
        // (verified at runtime) — not a bare rows array like INSERT ... RETURNING —
        // so unwrap the first element. An affected-0 update (already used) yields [].
        const result: unknown = await this.repo.query(
            `UPDATE otp_codes SET attempts = attempts + 1
             WHERE id = $1 AND used_at IS NULL RETURNING attempts`,
            [latest.id],
        );
        const updatedRows = (
            Array.isArray(result) && Array.isArray(result[0])
                ? result[0]
                : result
        ) as Array<{ attempts: number }>;
        const attempts = Number(
            updatedRows?.[0]?.attempts ?? OtpService.MAX_VERIFY_ATTEMPTS + 1,
        );
        if (attempts > OtpService.MAX_VERIFY_ATTEMPTS) {
            // Burn the code so it can no longer be guessed at all.
            await this.repo.update({ id: latest.id }, { usedAt: new Date() });
            throw new BadRequestException(
                'Too many attempts. Please request a new code.',
            );
        }
        if (latest.code !== codeTrim) {
            throw new BadRequestException('Invalid or expired OTP');
        }
        // Correct code, under the cap → consume atomically (single-use claim). Closes
        // the reset-race takeover where two requests submit the same code concurrently.
        const claim = await this.repo
            .createQueryBuilder()
            .update(OtpCode)
            .set({ usedAt: () => 'now()' })
            .where('id = :id AND used_at IS NULL', { id: latest.id })
            .execute();
        if (claim.affected === 0) {
            throw new BadRequestException('Invalid or expired OTP');
        }
        latest.usedAt = new Date();
        return latest;
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
