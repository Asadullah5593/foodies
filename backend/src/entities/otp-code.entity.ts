import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
} from 'typeorm';

@Entity('otp_codes')
export class OtpCode {
    @PrimaryGeneratedColumn()
    id: number;

    /** Email identifier (email OTP flows, e.g. password reset). */
    @Column({ type: 'varchar', nullable: true })
    email: string | null;

    /** Phone identifier (SMS OTP flows: phone_verification, password_reset). */
    @Column({ type: 'varchar', nullable: true })
    phone: string | null;

    @Column({ type: 'varchar', length: 10 })
    code: string;

    @Column({ type: 'varchar', length: 32, default: 'password_reset' })
    purpose: string;

    @Column({ type: 'timestamp' })
    expiresAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    usedAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;
}
