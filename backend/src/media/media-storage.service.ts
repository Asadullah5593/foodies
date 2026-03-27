import {
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';

type UploadFileInput = {
    originalname?: string;
    mimetype?: string;
    buffer?: Buffer;
};

type UploadResult = {
    url: string;
    key: string;
};

@Injectable()
export class MediaStorageService {
    private readonly logger = new Logger(MediaStorageService.name);
    private readonly driver = (process.env.MEDIA_STORAGE_DRIVER || 's3')
        .trim()
        .toLowerCase();
    private readonly region = process.env.AWS_REGION || 'ap-south-1';
    private readonly bucket = (process.env.AWS_S3_BUCKET || '').trim();
    private readonly keyPrefix = (process.env.AWS_S3_KEY_PREFIX || '')
        .trim()
        .replace(/^\/+|\/+$/g, '');
    private readonly cloudfrontBase = (process.env.AWS_CLOUDFRONT_URL || '')
        .trim()
        .replace(/\/+$/g, '');
    private readonly s3Client = new S3Client({ region: this.region });

    async uploadImage(
        file: UploadFileInput,
        folder: string,
    ): Promise<UploadResult> {
        if (this.driver !== 's3') {
            throw new InternalServerErrorException(
                'Only S3 media storage is supported',
            );
        }
        if (!file?.buffer) {
            throw new InternalServerErrorException('Upload buffer missing');
        }
        const safeFolder =
            (folder || 'misc').replace(/^\/+|\/+$/g, '') || 'misc';
        const filename = this.generateFilename(file.originalname);
        return this.uploadToS3(file, safeFolder, filename);
    }

    /**
     * Delete a previously uploaded media object, but only when URL is clearly
     * within our managed S3 bucket + allowed media folders.
     */
    async deleteManagedObjectByUrl(
        url: string | null | undefined,
        expectedFolder?: string,
    ): Promise<boolean> {
        if (this.driver !== 's3' || !this.bucket || !url) return false;
        const key = this.extractManagedKeyFromUrl(url, expectedFolder);
        if (!key) return false;
        try {
            await this.s3Client.send(
                new DeleteObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                }),
            );
            return true;
        } catch (err) {
            const error = err as { name?: string; message?: string };
            const reason =
                error?.name && error?.message
                    ? `${error.name}: ${error.message}`
                    : 'Unknown S3 error';
            this.logger.warn(`S3 delete skipped for key "${key}" - ${reason}`);
            return false;
        }
    }

    private async uploadToS3(
        file: UploadFileInput,
        folder: string,
        filename: string,
    ): Promise<UploadResult> {
        if (!this.bucket) {
            throw new InternalServerErrorException(
                'S3 is enabled but AWS_S3_BUCKET is not configured',
            );
        }
        const keyParts = [this.keyPrefix, folder, filename].filter(Boolean);
        const key = keyParts.join('/');
        try {
            await this.s3Client.send(
                new PutObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                    Body: file.buffer,
                    ContentType: file.mimetype || 'application/octet-stream',
                }),
            );
        } catch (err) {
            const error = err as { name?: string; message?: string };
            const reason =
                error?.name && error?.message
                    ? `${error.name}: ${error.message}`
                    : 'Unknown S3 error';
            this.logger.error(`S3 upload failed for key "${key}" - ${reason}`);
            throw new InternalServerErrorException(
                `S3 upload failed: ${reason}`,
            );
        }
        const base =
            this.cloudfrontBase ||
            `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
        return {
            url: `${base}/${key}`,
            key,
        };
    }

    private generateFilename(originalname?: string): string {
        const ext =
            originalname && originalname.includes('.')
                ? originalname
                      .slice(originalname.lastIndexOf('.'))
                      .toLowerCase()
                : '.png';
        const safeExt = ext.match(/^\.(png|jpe?g|gif|webp|svg)$/)
            ? ext
            : '.png';
        return `${randomBytes(16).toString('hex')}${safeExt}`;
    }

    private extractManagedKeyFromUrl(
        url: string,
        expectedFolder?: string,
    ): string | null {
        const trimmed = url.trim();
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
            return null;
        }

        let parsed: URL;
        try {
            parsed = new URL(trimmed);
        } catch {
            return null;
        }

        const s3Host = `${this.bucket}.s3.${this.region}.amazonaws.com`;
        const cloudfrontHost = this.cloudfrontBase
            ? new URL(this.cloudfrontBase).host
            : null;
        if (
            parsed.host !== s3Host &&
            (!cloudfrontHost || parsed.host !== cloudfrontHost)
        ) {
            return null;
        }

        const pathKey = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
        if (!pathKey) return null;

        const key = this.keyPrefix
            ? pathKey.startsWith(`${this.keyPrefix}/`)
                ? pathKey
                : null
            : pathKey;
        if (!key) return null;

        const relative = this.keyPrefix
            ? key.slice(this.keyPrefix.length + 1)
            : key;
        const folder = relative.split('/')[0] || '';
        const allowedFolders = new Set([
            'brands',
            'customer-profiles',
            'menu-items',
            'misc',
        ]);
        if (!allowedFolders.has(folder)) return null;
        if (expectedFolder && folder !== expectedFolder) return null;
        return key;
    }
}
