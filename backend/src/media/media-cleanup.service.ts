import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MediaStorageService } from './media-storage.service';

/**
 * Reference-guarded S3 cleanup. Callers hand over a URL that THEIR row just
 * stopped using (replaced, cleared, or the row was deleted); the object is
 * removed from storage only when NO database row references it any more.
 *
 * The guard exists because image URLs can legitimately be shared:
 *  - campaigns upload into the same `banners/` folder as banners;
 *  - menu category images are paste-a-URL (no dedicated uploader), so they
 *    borrow objects owned by menu items / other modules;
 *  - nothing stops an admin from pasting one uploaded URL into two records.
 * Deleting on replace without the check would break the other referencer.
 *
 * ALWAYS call this AFTER the mutating save/remove has committed — that way
 * "still referenced" precisely means "some row still needs it, keep it"
 * (including the caller's own row when its save failed).
 *
 * Cleanup is best-effort by design: any failure is logged and swallowed so a
 * storage hiccup can never fail the user's actual action. Non-S3 drivers and
 * URLs outside the app's managed bucket/prefix/folders are no-ops (enforced
 * by MediaStorageService.deleteManagedObjectByUrl).
 */
@Injectable()
export class MediaCleanupService {
    private readonly logger = new Logger(MediaCleanupService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly mediaStorage: MediaStorageService,
    ) {}

    /**
     * Every image-URL column in the schema. New media-bearing columns MUST be
     * added here, or their objects become deletable while still in use.
     */
    private async isUrlStillReferenced(url: string): Promise<boolean> {
        const rows = await this.dataSource.query<
            Array<{ referenced: boolean }>
        >(
            `SELECT (
                EXISTS (SELECT 1 FROM brands WHERE logo_url = $1)
                OR EXISTS (SELECT 1 FROM menu_items WHERE image_url = $1)
                OR EXISTS (
                    SELECT 1 FROM menu_items
                    WHERE gallery_image_urls IS NOT NULL
                      AND EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements_text(gallery_image_urls) AS g(u)
                          WHERE g.u = $1
                      )
                )
                OR EXISTS (SELECT 1 FROM menu_categories WHERE image_url = $1)
                OR EXISTS (SELECT 1 FROM banners WHERE image_url = $1)
                OR EXISTS (SELECT 1 FROM promotions WHERE image_url = $1)
                OR EXISTS (SELECT 1 FROM campaigns WHERE image_url = $1)
                OR EXISTS (SELECT 1 FROM campaign_items WHERE image_url = $1)
                OR EXISTS (SELECT 1 FROM customers WHERE profile_image_url = $1)
                -- config is a simple-json (text) column; TypeORM always writes
                -- valid JSON, so the jsonb cast is safe.
                OR EXISTS (
                    SELECT 1 FROM invoice_templates
                    WHERE config IS NOT NULL
                      AND config::jsonb->>'fbrLogoUrl' = $1
                )
            ) AS referenced`,
            [url],
        );
        return rows[0]?.referenced === true;
    }

    /**
     * Delete the object behind `url` unless some row still references it.
     * `expectedFolder` pins the delete to the folder the caller's module
     * uploads into (omit only when provenance is genuinely unknown, e.g.
     * pasted category images). Returns true when an object was deleted.
     */
    async deleteIfUnreferenced(
        url: string | null | undefined,
        expectedFolder?: string,
    ): Promise<boolean> {
        const trimmed = url?.trim();
        if (!trimmed) return false;
        try {
            if (await this.isUrlStillReferenced(trimmed)) {
                this.logger.debug(
                    `Kept media object (still referenced): ${trimmed}`,
                );
                return false;
            }
            return await this.mediaStorage.deleteManagedObjectByUrl(
                trimmed,
                expectedFolder,
            );
        } catch (err) {
            const e = err as { message?: string };
            this.logger.warn(
                `Media cleanup skipped for ${trimmed} - ${e?.message ?? 'unknown error'}`,
            );
            return false;
        }
    }

    /** deleteIfUnreferenced over a list (deduplicated). */
    async deleteManyIfUnreferenced(
        urls: Array<string | null | undefined>,
        expectedFolder?: string,
    ): Promise<void> {
        const unique = [
            ...new Set(
                urls
                    .map((u) => u?.trim())
                    .filter((u): u is string => !!u && u.length > 0),
            ),
        ];
        for (const url of unique) {
            await this.deleteIfUnreferenced(url, expectedFolder);
        }
    }
}
