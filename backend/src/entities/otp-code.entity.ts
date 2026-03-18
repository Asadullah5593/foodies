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

    @Column({ type: 'varchar' })
    email: string;

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
