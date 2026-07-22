import {
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import {
    DeleteObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import { ImageOptimizeService } from './image-optimize.service';
import {
    isMenuItemVariantKey,
    menuItemVariantKeys,
    menuItemVariantUrl,
} from './menu-image-variants';

type UploadFileInput = {
    originalname?: string;
    mimetype?: string;
    buffer?: Buffer;
};

export type UploadResult = {
    url: string;
    key: string;
    variants?: {
        thumb: string;
        display: string;
        full: string;
    };
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

    constructor(private readonly imageOptimize: ImageOptimizeService) {}

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

        if (safeFolder === 'menu-items') {
            return this.uploadMenuItemWithVariants(file, safeFolder);
        }

        const optimized = await this.imageOptimize.optimizeForUpload(
            file,
            safeFolder,
        );
        const filename = this.generateFilename(
            file.originalname,
            optimized.fileExtension,
        );
        return this.uploadToS3(
            {
                buffer: optimized.buffer,
                mimetype: optimized.contentType,
            },
            safeFolder,
            filename,
        );
    }

    /**
     * Delete a managed media object and, for menu-items, its variant siblings.
     */
    async deleteManagedObjectByUrl(
        url: string | null | undefined,
        expectedFolder?: string,
    ): Promise<boolean> {
        if (this.driver !== 's3' || !this.bucket || !url) return false;
        const key = this.extractManagedKeyFromUrl(url, expectedFolder);
        if (!key) return false;

        const keysToDelete = [key];
        const relative = this.keyPrefix
            ? key.slice(this.keyPrefix.length + 1)
            : key;
        const folder = relative.split('/')[0] || '';
        if (folder === 'menu-items' && !isMenuItemVariantKey(key)) {
            const variants = menuItemVariantKeys(key);
            keysToDelete.push(variants.thumb, variants.full);
        }

        let deleted = false;
        for (const objectKey of keysToDelete) {
            try {
                await this.s3Client.send(
                    new DeleteObjectCommand({
                        Bucket: this.bucket,
                        Key: objectKey,
                    }),
                );
                deleted = true;
            } catch (err) {
                const error = err as { name?: string; message?: string };
                const reason =
                    error?.name && error?.message
                        ? `${error.name}: ${error.message}`
                        : 'Unknown S3 error';
                this.logger.warn(
                    `S3 delete skipped for key "${objectKey}" - ${reason}`,
                );
            }
        }
        return deleted;
    }

    /** List object keys under a media folder (for backfill). */
    async listObjectKeysInFolder(folder: string): Promise<string[]> {
        if (!this.bucket) return [];
        const prefixParts = [this.keyPrefix, folder.replace(/^\/+|\/+$/g, '')]
            .filter(Boolean)
            .join('/');
        const prefix = prefixParts ? `${prefixParts}/` : '';
        const keys: string[] = [];
        let continuationToken: string | undefined;

        do {
            const res = await this.s3Client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: prefix,
                    ContinuationToken: continuationToken,
                }),
            );
            for (const obj of res.Contents ?? []) {
                if (obj.Key) keys.push(obj.Key);
            }
            continuationToken = res.NextContinuationToken;
        } while (continuationToken);

        return keys;
    }

    async downloadObject(key: string): Promise<Buffer> {
        if (!this.bucket) {
            throw new InternalServerErrorException(
                'S3 is enabled but AWS_S3_BUCKET is not configured',
            );
        }
        const res = await this.s3Client.send(
            new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        const bytes = await res.Body?.transformToByteArray();
        if (!bytes?.length) {
            throw new Error(`Empty object for key ${key}`);
        }
        return Buffer.from(bytes);
    }

    /**
     * Overwrite canonical key with display bytes and upload variant siblings.
     * Used by backfill; keeps the same public URL in the database.
     */
    async backfillMenuItemVariants(
        canonicalKey: string,
        variants: { thumb: Buffer; display: Buffer; full: Buffer },
    ): Promise<void> {
        const { thumb, full } = menuItemVariantKeys(canonicalKey);
        await this.putObject(canonicalKey, variants.display, 'image/jpeg');
        await this.putObject(thumb, variants.thumb, 'image/jpeg');
        await this.putObject(full, variants.full, 'image/jpeg');
    }

    private async uploadMenuItemWithVariants(
        file: UploadFileInput,
        folder: string,
    ): Promise<UploadResult> {
        const variants = await this.imageOptimize.optimizeMenuVariants(file);
        const filename = `${randomBytes(16).toString('hex')}.jpg`;
        const display = await this.uploadToS3(
            { buffer: variants.display, mimetype: 'image/jpeg' },
            folder,
            filename,
        );
        const { thumb: thumbKey, full: fullKey } = menuItemVariantKeys(
            display.key,
        );
        await this.putObject(thumbKey, variants.thumb, 'image/jpeg');
        await this.putObject(fullKey, variants.full, 'image/jpeg');

        const displayUrl = display.url;
        return {
            url: displayUrl,
            key: display.key,
            variants: {
                thumb: menuItemVariantUrl(displayUrl, 'thumb'),
                display: displayUrl,
                full: menuItemVariantUrl(displayUrl, 'full'),
            },
        };
    }

    private async putObject(
        key: string,
        body: Buffer,
        contentType: string,
    ): Promise<void> {
        if (!this.bucket) {
            throw new InternalServerErrorException(
                'S3 is enabled but AWS_S3_BUCKET is not configured',
            );
        }
        try {
            await this.s3Client.send(
                new PutObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                    Body: body,
                    ContentType: contentType,
                    CacheControl: 'public, max-age=31536000, immutable',
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
    }

    private async uploadToS3(
        file: { buffer?: Buffer; mimetype?: string },
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
        await this.putObject(
            key,
            file.buffer!,
            file.mimetype || 'application/octet-stream',
        );
        const base =
            this.cloudfrontBase ||
            `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
        return {
            url: `${base}/${key}`,
            key,
        };
    }

    private generateFilename(
        originalname?: string,
        preferredExt?: string,
    ): string {
        const ext =
            preferredExt ??
            (originalname && originalname.includes('.')
                ? originalname
                      .slice(originalname.lastIndexOf('.'))
                      .toLowerCase()
                : '.png');
        const safeExt = ext.match(/^\.(png|jpe?g|gif|webp|svg)$/)
            ? ext
            : '.jpg';
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
        // Must cover every folder the upload endpoints write to (see
        // upload.controller.ts) — a folder missing here silently exempts its
        // objects from cleanup on replace/delete.
        const allowedFolders = new Set([
            'brands',
            'customer-profiles',
            'menu-items',
            'misc',
            'banners',
            'promotions',
        ]);
        if (!allowedFolders.has(folder)) return null;
        if (expectedFolder && folder !== expectedFolder) return null;
        return key;
    }
}
