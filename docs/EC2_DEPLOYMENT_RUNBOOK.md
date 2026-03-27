# EC2 Deployment Runbook (PM2 + Nginx, no Docker)

This repo is a **Vite/React frontend** (`frontend/`) + **NestJS backend** (`backend/`) with PostgreSQL.

This runbook assumes your EC2 is already set up with:

- **PM2** running the backend on `127.0.0.1:3001`
- **Nginx** listening on `:80` and serving the built frontend from **`/var/www/foodies`**
- Nginx reverse-proxy:
  - `/api/*` → `http://127.0.0.1:3001/api/*`
  - `/api-docs` → `http://127.0.0.1:3001/api-docs`

If you change any of those paths/ports, update the commands below accordingly.

---

## Golden rules (avoid common production mistakes)

- **Do not develop on EC2.** Only `git pull` and build/restart services. Don’t commit/push from EC2.
- **Backend restarts + migrations are the risky part.** Always take a DB backup before schema changes.
- **Frontend “not reflecting” is usually because Nginx serves `/var/www/foodies`,** so you must publish your `dist/` there after each build.

---

## One-command deploy (typical update after pushing to GitHub)

Run on EC2 from your repo root (`~/foodies`):

```bash
set -e

cd ~/foodies

# 1) Update code from GitHub
git fetch origin
git checkout main
git pull --ff-only origin main

# 2) Backend: install/build, then restart the API
cd ~/foodies/backend
npm install --legacy-peer-deps
npm run build
pm2 restart foodies-backend

# 3) Frontend: build with same-origin API and publish to nginx web root
cd ~/foodies/frontend
npm install
echo "VITE_API_URL=/api" > .env.production
npm run build

sudo rsync -a --delete dist/ /var/www/foodies/
sudo chown -R www-data:www-data /var/www/foodies
sudo chmod -R 755 /var/www/foodies

# 4) Reload nginx (picks up new static files/config)
sudo systemctl reload nginx

# 5) Smoke test locally on EC2
curl -sS http://127.0.0.1/api/ && echo
```

### What this does

- **Pulls code** exactly matching `origin/main` (fast-forward only).
- **Rebuilds backend** to `backend/dist/` and restarts it via PM2.
- **Builds frontend** to `frontend/dist/`, then **publishes** it to `/var/www/foodies` (the folder Nginx serves).
- **Reloads Nginx** so requests serve the latest build.
- **Verifies** backend health via the Nginx proxy (`/api/`).

---

## Health checks (when something “doesn’t work”)

Run on EC2:

### Check backend is running and listening

```bash
pm2 status
sudo ss -lntp | grep 3001 || true
curl -sS http://127.0.0.1:3001/api/ && echo
```

### Check Nginx proxy and frontend locally

```bash
curl -I http://127.0.0.1/
curl -sS http://127.0.0.1/api/ && echo
curl -I http://127.0.0.1/api-docs
```

### Check logs

```bash
pm2 logs foodies-backend --lines 200
sudo tail -n 200 /var/log/nginx/error.log
sudo tail -n 200 /var/log/nginx/access.log
```

---

## Migrations: how to update schema safely

### How this backend applies migrations

In `backend/src/app.module.ts`, TypeORM is configured with:

- `synchronize: false`
- `migrationsRun: true`

Meaning: **the API will run pending migrations automatically when it starts**.

### Recommended workflow before a deploy that includes migrations

1) **Backup the DB**

```bash
sudo -u postgres pg_dump -Fc -d foodies > /tmp/foodies_$(date +%F_%H%M).dump
ls -lah /tmp/foodies_*.dump | tail -n 1
```

2) Deploy as usual (pull → build → restart). If the backend fails at startup, inspect:

```bash
pm2 logs foodies-backend --lines 300
```

### If the backend crashes with “relation already exists”

That indicates your DB schema doesn’t match the migration state (often the `migrations` table is missing/out of sync).

**Best practice:** restore from a consistent backup that includes the `migrations` table.

**Do NOT fix production by dropping random tables** unless you are intentionally resetting the environment.

---

## Database restore (importing an existing backup)

### Plain SQL file (`.sql`)

```bash
pm2 stop foodies-backend

sudo -u postgres dropdb --if-exists foodies
sudo -u postgres createdb -O foodies_user foodies

# If the SQL file is in /home/ubuntu
sudo cp ~/foodies.sql /tmp/foodies.sql
sudo chmod 644 /tmp/foodies.sql

sudo -u postgres psql -d foodies -f /tmp/foodies.sql
```

### Custom-format dump (`pg_dump -Fc`) (`.dump` / `.backup`)

```bash
pm2 stop foodies-backend

sudo -u postgres dropdb --if-exists foodies
sudo -u postgres createdb -O foodies_user foodies

sudo -u postgres pg_restore --no-owner --role=foodies_user -d foodies /path/to/foodies.dump
```

### After restore: fix ownership/privileges (common requirement)

Some backups restore objects owned by another role. If your app connects as `foodies_user`, make sure it can read/write tables:

```bash
sudo -u postgres psql -d foodies -c "ALTER SCHEMA public OWNER TO foodies_user;"
sudo -u postgres psql -d foodies -c "GRANT ALL ON SCHEMA public TO foodies_user;"

sudo -u postgres psql -d foodies -c "
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO foodies_user', r.schemaname, r.tablename);
  END LOOP;
END
\$\$;"

sudo -u postgres psql -d foodies -c "
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT sequence_schema, sequence_name FROM information_schema.sequences WHERE sequence_schema='public'
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO foodies_user', r.sequence_schema, r.sequence_name);
  END LOOP;
END
\$\$;"
```

Then restart:

```bash
pm2 start foodies-backend
curl -sS http://127.0.0.1:3001/api/ && echo
```

---

## Frontend publishing (why builds sometimes “don’t reflect”)

### Current setup

- You build to: `~/foodies/frontend/dist`
- Nginx serves: `/var/www/foodies`

So after each build you must publish:

```bash
sudo rsync -a --delete ~/foodies/frontend/dist/ /var/www/foodies/
sudo systemctl reload nginx
```

### Confirm which JS bundle Nginx is serving

```bash
curl -sS http://127.0.0.1/ | grep -Eo 'assets/[^"]+\.js' | head -n 5
ls -la /var/www/foodies/assets | head
```

---

## Nginx config (reference)

Your active site file is typically:

- `/etc/nginx/sites-available/foodies`
- symlinked to `/etc/nginx/sites-enabled/foodies`

After editing:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Rollback (when a deploy breaks)

### Roll back to a previous Git commit

```bash
cd ~/foodies
git fetch origin

# pick a known-good commit hash from:
git log --oneline -10

# checkout that commit (detached HEAD) OR create a rollback branch
git checkout <GOOD_COMMIT_HASH>

# rebuild + restart
cd ~/foodies/backend && npm install --legacy-peer-deps && npm run build && pm2 restart foodies-backend
cd ~/foodies/frontend && npm install && echo "VITE_API_URL=/api" > .env.production && npm run build
sudo rsync -a --delete ~/foodies/frontend/dist/ /var/www/foodies/
sudo systemctl reload nginx
```

### Roll back the database

Use your latest dump from `/tmp/foodies_*.dump`:

```bash
pm2 stop foodies-backend
sudo -u postgres dropdb --if-exists foodies
sudo -u postgres createdb -O foodies_user foodies
sudo -u postgres pg_restore --no-owner --role=foodies_user -d foodies /tmp/foodies_YYYY-MM-DD_HHMM.dump
pm2 start foodies-backend
```

---

## Security checklist (minimum)

- Security group inbound:
  - `22` from your IP only
  - `80` from `0.0.0.0/0`
  - `443` from `0.0.0.0/0` (when you add HTTPS)
- Keep backend port `3001` **closed to the internet**; access it only via Nginx proxy.

---

## S3 + CloudFront media setup (production)

Use this section when enabling `MEDIA_STORAGE_DRIVER=s3`.

### 1) Create buckets (single bucket per environment)

Recommended names:

- Prod: `rough-foodie-prod-media-<accountid>-<region>`
- Staging: `rough-foodie-staging-media-<accountid>-<region>`

Recommended object prefixes:

- `menu-items/`
- `customer-profiles/`
- `brands/`
- `misc/`

Bucket settings:

- Block all public access: **ON**
- Versioning: **ON**
- Default encryption: **SSE-S3** (or KMS if your policy requires it)

### 2) Create CloudFront distribution (private S3 origin)

- Origin: selected S3 bucket
- Origin access: **OAC** (Origin Access Control), not public bucket
- Viewer protocol policy: **Redirect HTTP to HTTPS**
- Allowed methods: `GET, HEAD`
- Cache policy: `CachingOptimized`
- Optional custom domain: `media.roughfoodie.com`

### 3) Bucket policy for CloudFront read-only access

Replace placeholders and apply to the S3 bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::rough-foodie-prod-media-<accountid>-<region>/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<accountid>:distribution/<distribution-id>"
        }
      }
    }
  ]
}
```

### 4) IAM policy for backend upload role

Attach this to the EC2/ECS runtime role (preferred over static keys):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BucketList",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::rough-foodie-prod-media-<accountid>-<region>"
    },
    {
      "Sid": "ObjectWriteReadDelete",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::rough-foodie-prod-media-<accountid>-<region>/*"
    }
  ]
}
```

### 5) Backend environment variables on EC2

Set in backend `.env` (or your secret manager):

```bash
MEDIA_STORAGE_DRIVER=s3
AWS_REGION=ap-south-1
AWS_S3_BUCKET=rough-foodie-prod-media-<accountid>-ap-south-1
AWS_S3_KEY_PREFIX=
AWS_CLOUDFRONT_URL=https://media.roughfoodie.com
```

Only if you are **not** using an IAM role:

```bash
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

### 6) Verify upload and access

1. Upload an image from Admin (menu item/brand) or consumer profile.
2. Confirm API returns an absolute CloudFront URL.
3. Open the returned CloudFront URL in browser (should load).
4. Try direct S3 URL if bucket is private (should not be publicly accessible unless signed/allowed).

