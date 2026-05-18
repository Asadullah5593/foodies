import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { MENU_IMAGE_VARIANT_WIDTHS } from './menu-image-variants';

type UploadFileInput = {
    originalname?: string;
    mimetype?: string;
    buffer?: Buffer;
};

export type OptimizedImage = {
    buffer: Buffer;
    contentType: string;
    fileExtension: string;
};

export type MenuImageVariantBuffers = {
    thumb: Buffer;
    display: Buffer;
    full: Buffer;
};

const SKIP_REENCODE_BELOW_BYTES = 200 * 1024;

@Injectable()
export class ImageOptimizeService {
    private readonly jpegQuality = Math.min(
        100,
        Math.max(
            50,
            parseInt(process.env.MEDIA_IMAGE_JPEG_QUALITY || '82', 10) || 82,
        ),
    );

    private maxWidthForFolder(folder: string): number {
        switch (folder) {
            case 'brands':
                return (
                    parseInt(
                        process.env.MEDIA_IMAGE_MAX_WIDTH_BRANDS || '512',
                        10,
                    ) || 512
                );
            case 'customer-profiles':
                return (
                    parseInt(
                        process.env.MEDIA_IMAGE_MAX_WIDTH_PROFILE || '800',
                        10,
                    ) || 800
                );
            case 'menu-items':
            case 'misc':
            default:
                return (
                    parseInt(
                        process.env.MEDIA_IMAGE_MAX_WIDTH_MENU || '1400',
                        10,
                    ) || 1400
                );
        }
    }

    /**
     * Three JPEG variants for menu-items: thumb (320), display (960), full (1400).
     * Always re-encodes — no skip path.
     */
    async optimizeMenuVariants(
        file: UploadFileInput,
    ): Promise<MenuImageVariantBuffers> {
        const buffer = file.buffer;
        if (!buffer?.length) {
            throw new Error('Upload buffer missing');
        }

        const mimetype = (file.mimetype || '').toLowerCase();
        if (mimetype === 'image/svg+xml' || mimetype.includes('svg')) {
            throw new Error('SVG uploads are not supported for menu-item variants');
        }
        if (!/^image\/(png|jpe?g|gif|webp)$/i.test(mimetype)) {
            throw new Error('Unsupported image type for menu-item variants');
        }

        const widths = [
            MENU_IMAGE_VARIANT_WIDTHS.thumb,
            MENU_IMAGE_VARIANT_WIDTHS.display,
            MENU_IMAGE_VARIANT_WIDTHS.full,
        ] as const;

        const buffers = await Promise.all(
            widths.map((width) =>
                sharp(buffer)
                    .rotate()
                    .resize({
                        width,
                        height: width,
                        fit: 'inside',
                        withoutEnlargement: true,
                    })
                    .jpeg({ quality: this.jpegQuality, mozjpeg: true })
                    .toBuffer(),
            ),
        );

        return {
            thumb: buffers[0],
            display: buffers[1],
            full: buffers[2],
        };
    }

    async optimizeForUpload(
        file: UploadFileInput,
        folder: string,
    ): Promise<OptimizedImage> {
        const buffer = file.buffer;
        if (!buffer?.length) {
            throw new Error('Upload buffer missing');
        }

        const mimetype = (file.mimetype || '').toLowerCase();

        if (mimetype === 'image/svg+xml' || mimetype.includes('svg')) {
            return {
                buffer,
                contentType: mimetype || 'image/svg+xml',
                fileExtension: '.svg',
            };
        }

        if (!/^image\/(png|jpe?g|gif|webp)$/i.test(mimetype)) {
            return {
                buffer,
                contentType: mimetype || 'application/octet-stream',
                fileExtension: this.extensionFromMime(mimetype),
            };
        }

        const maxWidth = this.maxWidthForFolder(folder);
        const meta = await sharp(buffer).metadata();
        const width = meta.width ?? 0;

        // menu-items always use optimizeMenuVariants; never skip re-encode here
        if (
            folder !== 'menu-items' &&
            buffer.length < SKIP_REENCODE_BELOW_BYTES &&
            width > 0 &&
            width <= maxWidth
        ) {
            return {
                buffer,
                contentType: mimetype,
                fileExtension: this.extensionFromMime(mimetype),
            };
        }

        const out = await sharp(buffer)
            .rotate()
            .resize({
                width: maxWidth,
                height: maxWidth,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .jpeg({ quality: this.jpegQuality, mozjpeg: true })
            .toBuffer();

        return {
            buffer: out,
            contentType: 'image/jpeg',
            fileExtension: '.jpg',
        };
    }

    private extensionFromMime(mimetype: string): string {
        if (mimetype.includes('png')) return '.png';
        if (mimetype.includes('webp')) return '.webp';
        if (mimetype.includes('gif')) return '.gif';
        if (mimetype.includes('jpeg') || mimetype.includes('jpg')) {
            return '.jpg';
        }
        return '.jpg';
    }
}
