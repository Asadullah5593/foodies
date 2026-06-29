import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    SNSClient,
    PublishCommand,
    type MessageAttributeValue,
} from '@aws-sdk/client-sns';
import { toE164Pakistani } from '../utils/phone';

/** Default alphanumeric sender ID (Pakistan supports sender IDs). */
const DEFAULT_SENDER_ID = 'Foodies';
const DEFAULT_OTP_EXPIRY_MINUTES = 15;

/** Minimal channel abstraction so the provider can be swapped later. */
interface SmsProvider {
    send(e164: string, message: string): Promise<void>;
}

/** Amazon SNS implementation. Mirrors the S3 client pattern in media-storage. */
class SnsSmsProvider implements SmsProvider {
    constructor(
        private readonly client: SNSClient,
        private readonly senderId: string | undefined,
    ) {}

    async send(e164: string, message: string): Promise<void> {
        const attributes: Record<string, MessageAttributeValue> = {
            // Transactional = higher delivery priority (right for OTP).
            'AWS.SNS.SMS.SMSType': {
                DataType: 'String',
                StringValue: 'Transactional',
            },
        };
        if (this.senderId) {
            attributes['AWS.SNS.SMS.SenderID'] = {
                DataType: 'String',
                StringValue: this.senderId,
            };
        }
        await this.client.send(
            new PublishCommand({
                PhoneNumber: e164,
                Message: message,
                MessageAttributes: attributes,
            }),
        );
    }
}

/**
 * Sends transactional SMS (OTP) via Amazon SNS. Follows the same wrapper +
 * dev-fallback shape as MailService: when the provider is not configured the
 * code is logged to the console instead of sent, so local development needs no
 * AWS account.
 */
@Injectable()
export class SmsService {
    private readonly logger = new Logger(SmsService.name);
    private readonly provider: SmsProvider | null = null;

    constructor(private config: ConfigService) {
        const providerName = (this.config.get<string>('SMS_PROVIDER') || 'sns')
            .trim()
            .toLowerCase();
        // Reuse the app-wide AWS region (same default as media-storage) unless a
        // dedicated SMS region is set (some regions don't support SMS).
        const region = (
            this.config.get<string>('AWS_SNS_REGION') ||
            this.config.get<string>('AWS_REGION') ||
            'ap-south-1'
        ).trim();
        const senderId =
            (
                this.config.get<string>('SMS_SENDER_ID') || DEFAULT_SENDER_ID
            ).trim() || undefined;

        if (providerName === 'sns' && region) {
            // Prefer dedicated SMS credentials so the SNS user (SNS-only IAM)
            // doesn't override the S3/general credentials or the EC2 IAM role.
            // Fall back to the SDK default chain (env AWS_* or IAM role) when
            // the dedicated keys aren't set.
            const accessKeyId = (
                this.config.get<string>('SMS_AWS_ACCESS_KEY_ID') || ''
            ).trim();
            const secretAccessKey = (
                this.config.get<string>('SMS_AWS_SECRET_ACCESS_KEY') || ''
            ).trim();
            const clientConfig: {
                region: string;
                credentials?: { accessKeyId: string; secretAccessKey: string };
            } = { region };
            if (accessKeyId && secretAccessKey) {
                clientConfig.credentials = { accessKeyId, secretAccessKey };
            }
            this.provider = new SnsSmsProvider(
                new SNSClient(clientConfig),
                senderId,
            );
            this.logger.log(
                `SMS provider configured (sns, region=${region}${senderId ? `, senderId=${senderId}` : ''}, creds=${clientConfig.credentials ? 'dedicated' : 'default-chain'})`,
            );
        } else {
            this.logger.warn(
                'SMS not configured (set SMS_PROVIDER=sns and AWS_SNS_REGION/AWS_REGION). OTP will be logged to console only.',
            );
        }
    }

    private get expiryMinutes(): number {
        const m = parseInt(
            this.config.get<string>('OTP_EXPIRY_MINUTES') || '',
            10,
        );
        return Number.isFinite(m) && m > 0 ? m : DEFAULT_OTP_EXPIRY_MINUTES;
    }

    /**
     * Send an OTP code to a Pakistani phone number. Accepts any local/E.164
     * form; converts to E.164 for the provider. If SMS is not configured, logs
     * the code (development).
     */
    async sendOtp(phone: string, code: string): Promise<void> {
        const e164 = toE164Pakistani(phone);
        if (!e164) {
            throw new BadRequestException(
                'Invalid Pakistani phone number. Use format: 03XXXXXXXXX (e.g. 03001234567)',
            );
        }
        const message = `Your Foodies verification code is ${code}. It expires in ${this.expiryMinutes} minutes.`;

        if (this.provider) {
            try {
                await this.provider.send(e164, message);
                this.logger.log(`OTP SMS sent to ${e164}`);
            } catch (err) {
                this.logger.error(
                    `Failed to send OTP SMS to ${e164}: ${err instanceof Error ? err.message : String(err)}`,
                );
                if (err instanceof Error && err.stack) {
                    this.logger.debug(err.stack);
                }
                throw err;
            }
        } else {
            this.logger.warn(
                `[DEV] SMS not configured. OTP for ${e164}: ${code}`,
            );
        }
    }
}
