import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OtpCode } from '../entities/otp-code.entity';

@Injectable()
export class OtpService {
    constructor(@InjectRepository(OtpCode) private repo: Repository<OtpCode>) {}

    /** Generate a 6-digit numeric OTP code. */
    private generateCode(): string {
        const n = Math.floor(Math.random() * 900000) + 100000;
        return String(n);
    }

    /** Create OTP for email (e.g. password_reset). Expires in 15 minutes. */
    async create(
        email: string,
        purpose: string = 'password_reset',
    ): Promise<{ code: string; expiresAt: Date }> {
        const trimmed =
            typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!trimmed) throw new BadRequestException('Email is required');
        const code = this.generateCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
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

    /** Verify OTP and mark as used. Returns the OTP record. */
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
}
