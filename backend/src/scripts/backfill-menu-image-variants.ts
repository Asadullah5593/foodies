/**
 * Generate _w320 / _w1400 variants and replace canonical objects with display (~960w) JPEGs.
 *
 * Usage:
 *   npm run backfill:menu-images
 *   npm run backfill:menu-images -- --dry-run
 *   npm run backfill:menu-images -- --limit=10
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ImageOptimizeService } from '../media/image-optimize.service';
import { MediaStorageService } from '../media/media-storage.service';
import {
    isMenuItemVariantKey,
    menuItemVariantKeys,
} from '../media/menu-image-variants';

dotenvConfig({ path: join(process.cwd(), '.env') });

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const WARN_CANONICAL_BYTES = 500 * 1024;

function parseArgs() {
    const dryRun = process.argv.includes('--dry-run');
    const limitArg = process.argv.find((a) => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '', 10) : 0;
    return { dryRun, limit: Number.isFinite(limit) && limit > 0 ? limit : 0 };
}

async function main() {
    const { dryRun, limit } = parseArgs();
    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn', 'log'],
    });

    const media = app.get(MediaStorageService);
    const optimizer = app.get(ImageOptimizeService);

    const keys = await media.listObjectKeysInFolder('menu-items');
    const bases = keys.filter(
        (key) => !isMenuItemVariantKey(key) && IMAGE_EXT.test(key),
    );

    let processed = 0;
    let skipped = 0;

    for (const key of bases) {
        if (limit > 0 && processed >= limit) break;

        const { thumb: thumbKey, full: fullKey } = menuItemVariantKeys(key);
        if (keys.includes(thumbKey) && keys.includes(fullKey)) {
            skipped++;
            continue;
        }

        const buffer = await media.downloadObject(key);
        if (buffer.length > WARN_CANONICAL_BYTES) {
            console.log(
                `Processing large object ${key} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`,
            );
        }

        const variants = await optimizer.optimizeMenuVariants({
            buffer,
            mimetype: 'image/jpeg',
        });

        if (dryRun) {
            console.log(
                `[dry-run] ${key} → display ${variants.display.length} B, thumb ${variants.thumb.length} B, full ${variants.full.length} B`,
            );
        } else {
            await media.backfillMenuItemVariants(key, variants);
            console.log(`Backfilled ${key}`);
        }

        processed++;
    }

    console.log(
        `Done. processed=${processed} skipped_existing_variants=${skipped} dryRun=${dryRun}`,
    );
    await app.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
