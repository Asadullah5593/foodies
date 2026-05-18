# Media delivery (S3 and optional CloudFront)

Menu and brand images are stored in S3. The consumer website loads them **directly** from S3 or CloudFront (not through Next.js `/_next/image`).

## Menu item image variants

Each **menu-items** upload produces three JPEG objects:

| File | Width | Consumer use |
|------|-------|----------------|
| `{id}.jpg` (canonical URL in DB) | 960 | PDP hero, display size |
| `{id}_w320.jpg` | 320 | Menu grid, PDP thumbnails, related items |
| `{id}_w1400.jpg` | 1400 | Optional large / zoom |

The consumer app derives variant URLs from the canonical URL (see `consumer-web/src/lib/menu-image-url.ts`).

**Existing** large objects must be backfilled once:

```bash
cd backend
npm run backfill:menu-images          # all menu-items bases missing variants
npm run backfill:menu-images -- --dry-run
npm run backfill:menu-images -- --limit=20
```

Backfill overwrites the canonical S3 object with the 960w JPEG (same URL, smaller bytes) and adds `_w320` / `_w1400` siblings.

## Default setup (staging / low traffic)

1. Set backend media env in `backend/.env`:
   - `MEDIA_STORAGE_DRIVER=s3`
   - `AWS_REGION`, `AWS_S3_BUCKET`, credentials (or IAM role)
   - Leave `AWS_CLOUDFRONT_URL` empty — API returns S3 URLs.

2. Optional consumer preconnect in `consumer-web/.env.local`:
   ```bash
   NEXT_PUBLIC_MEDIA_ORIGIN=https://YOUR_BUCKET.s3.REGION.amazonaws.com
   ```

3. Restart backend after changing upload settings.

New uploads are resized/compressed on the Nest server before `PutObject` (see env vars below).

## Optional CloudFront (production)

CloudFront is **not** free long-term. New AWS accounts often get ~1 TB/month data transfer out for 12 months; after that you pay per GB. There is **no Lambda** and no edge image resizing in this setup—only caching.

### Steps

1. In AWS Console, create a **CloudFront distribution**:
   - **Origin:** your S3 bucket (REST or OAI/OAC as you prefer).
   - **Default cache behavior:** GET/HEAD, cache based on path.
   - Do **not** add Lambda@Edge or custom origin request policies unless you need them.

2. Set backend env:
   ```bash
   AWS_CLOUDFRONT_URL=https://dxxxxxxxxxxxxx.cloudfront.net
   ```
   Restart the backend. New upload URLs use the CloudFront domain.

3. Set consumer preconnect (same host):
   ```bash
   NEXT_PUBLIC_MEDIA_ORIGIN=https://dxxxxxxxxxxxxx.cloudfront.net
   ```

4. If you use nginx in front of the API, ensure `client_max_body_size` is at least **25m** for admin uploads.

### When to enable

- Production or users far from the S3 region.
- Staging can stay on direct S3.

## Upload tuning (backend)

| Variable | Default | Purpose |
|----------|---------|---------|
| `MEDIA_IMAGE_MAX_WIDTH_MENU` | 1400 | `misc`; menu-items use fixed variant widths |
| `MEDIA_IMAGE_MAX_WIDTH_BRANDS` | 512 | `brands` |
| `MEDIA_IMAGE_MAX_WIDTH_PROFILE` | 800 | `customer-profiles` |
| `MEDIA_IMAGE_JPEG_QUALITY` | 82 | JPEG quality after resize |

S3 objects are stored with `Cache-Control: public, max-age=31536000, immutable`.

## Verify consumer loads

1. Run backfill for legacy menu photos (or upload a new item in admin).
2. Open a menu item PDP (e.g. `/menu/594`).
3. DevTools → Network: hero loads canonical `*.jpg`, thumbs load `*_w320.jpg`, total image transfer should be **under ~5 MB** on first paint (not tens of MB).
4. Image hosts should be `https://…s3…` or `https://…cloudfront.net/…`, **not** `/_next/image`.
