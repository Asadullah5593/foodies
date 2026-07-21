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
- **The database is on RDS, not on the EC2 box.** There is also an old, unused `foodies` database in the EC2's local PostgreSQL, left over from an earlier setup. `sudo -u postgres psql -d foodies` connects to **that stale copy** — it looks plausible (same name, same tables) but is months out of date. Every DB command in this runbook therefore connects to RDS explicitly. See **Database connection** below and never use `sudo -u postgres` for anything production.

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

## Consumer web (Next.js public site, port 3002)

The public consumer site lives in `consumer-web/`. CI builds it on every merge, but **production deploy today only publishes the admin Vite SPA** to `/var/www/foodies`. To serve the consumer site (including the coming-soon gate) on your public domain:

### 1. Environment variables (PM2)

Create `consumer-web/.env.production.local` on the server (do not commit secrets):

```bash
COMING_SOON_ENABLED=true
COMING_SOON_BYPASS_SECRET=<long-random-string>
```

Team preview URL (sets an httpOnly cookie, then full routes work):

`https://<your-domain>/?preview=<COMING_SOON_BYPASS_SECRET>`

To launch the full site later, set `COMING_SOON_ENABLED=false` and restart PM2.

### 2. Build and run with PM2

```bash
cd ~/foodies/consumer-web
npm ci
npm run build
pm2 start npm --name foodies-consumer --cwd ~/foodies/consumer-web -- start
# Or after first setup:
pm2 restart foodies-consumer
```

`next start` listens on **port 3002** (see `consumer-web/package.json`).

### 3. Nginx: proxy public domain to consumer-web

Example server block (adjust `server_name` and paths). Keep `/api` pointing at the Nest backend on `:3001`:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location / {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Reload nginx after editing: `sudo nginx -t && sudo systemctl reload nginx`.

### 4. Smoke test

```bash
curl -sI http://127.0.0.1:3002/ | head -n 5
curl -sI http://127.0.0.1:3002/menu | head -n 5   # should redirect to /coming-soon when gate is on
curl -sI http://127.0.0.1/ | head -n 5            # via nginx
```

Static legal pages (`/privacy-policy.html`, etc.) remain reachable without the preview cookie (served from `consumer-web/public/`).

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

### Database connection

The app's credentials in `backend/.env` are the single source of truth for which
database is production. Load them into the standard `PG*` variables once per
shell and every `psql` / `pg_dump` / `pg_restore` below works with no flags:

```bash
cd ~/foodies/backend
export PGHOST=$(grep -E '^DB_HOST='     .env | cut -d= -f2-)
export PGPORT=$(grep -E '^DB_PORT='     .env | cut -d= -f2-)
export PGUSER=$(grep -E '^DB_USERNAME=' .env | cut -d= -f2-)
export PGDATABASE=$(grep -E '^DB_DATABASE=' .env | cut -d= -f2-)
export PGPASSWORD=$(grep -E '^DB_PASSWORD=' .env | cut -d= -f2-)
export PATH=/usr/lib/postgresql/17/bin:$PATH   # see client version note
```

Confirm you are pointed at RDS, not the stale local database:

```bash
psql -c "SELECT current_database(), inet_server_addr();"
```

`inet_server_addr()` must show an RDS address. If it is empty or `127.0.0.1`,
your `PG*` variables did not load and you are on the local decoy — stop and fix
it before running anything destructive.

**Client version.** RDS runs PostgreSQL 17; Ubuntu 24.04 ships the v16 client,
and `pg_dump` refuses to dump a newer server (`aborting because of server version
mismatch`). Install the matching client once per box:

```bash
sudo apt install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-client-17
```

(`PGPASSWORD` in the environment is readable by other processes of the same
user. On a shared box use a `~/.pgpass` file with mode 600 instead.)

### Recommended workflow before a deploy that includes migrations

1) **Backup the DB** (after exporting the `PG*` variables above)

```bash
mkdir -p ~/db-backups
pg_dump -Fc > ~/db-backups/foodies_$(date +%F_%H%M).dump
ls -lah ~/db-backups/ | tail -n 3
```

**Verify the dump — size alone proves nothing.** A truncated or wrong-database
dump looks like a perfectly ordinary file:

```bash
D=$(ls -t ~/db-backups/foodies_*.dump | head -1)
pg_restore -l "$D" | grep -c "TABLE DATA"
pg_restore -l "$D" | grep -E "TABLE DATA public (orders|users|branches|customers|migrations) "
```

Expect a count in the 90s and all five tables listed. `migrations` is the one
that matters most: without it a restore re-runs every migration from scratch
against an already-migrated schema and the backend will not boot.

**Take the dump with the backend stopped** if it is your rollback point for this
deploy. `pg_dump` snapshots the moment it *starts*, so orders taken between the
dump and `pm2 stop` exist in neither the dump nor the restored database.

**Copy it off the instance.** `/tmp` is cleared on reboot, and a backup that only
exists on the box it protects is not a backup:

```bash
# from your laptop, not the server
scp -i <key.pem> ubuntu@<public-ip>:~/db-backups/foodies_<stamp>.dump ~/Downloads/
```

2) Deploy as usual (pull → build → restart). If the backend fails at startup, inspect:

```bash
pm2 logs foodies-backend --lines 300
```

### If the backend crashes with “relation already exists” / “constraint … already exists”

The schema has a change that the `migrations` table does not record, so TypeORM
re-runs a migration that has effectively already been applied. Not every
migration is safe to re-run: `ADD COLUMN IF NOT EXISTS` is idempotent, but
Postgres has no `IF NOT EXISTS` for `ADD CONSTRAINT`, so those fail on the
second run and the API will not boot.

**Diagnose** — compare what is recorded against what exists:

```bash
psql -c "SELECT id, timestamp, name FROM migrations ORDER BY timestamp DESC LIMIT 10;"
psql -c "SELECT name FROM migrations WHERE name ~ 'Premises|UserPhone|AutoDispatch';"
psql -c "\d branches" | grep -E 'premises_radius_m|auto_dispatch_enabled'
```

Order by `timestamp`, not `id` — `id` reflects insertion order, which a past
restore can scramble, making a current database look years behind.

**If a migration's changes are already present but unrecorded,** mark it applied
rather than letting it re-run (name and timestamp must match the class exactly):

```bash
psql -c "INSERT INTO migrations (timestamp, name) VALUES (1760000000091, 'BranchPremisesRadius1760000000091');"
```

**Otherwise** restore from a verified backup that includes the `migrations` table.

**Do NOT fix production by dropping random tables** unless you are intentionally resetting the environment.

---

## Database restore (importing an existing backup)

> **Destructive.** Every command here erases the current production database.
> Confirm `psql -c "SELECT current_database(), inet_server_addr();"` points at
> RDS first — on this box the same commands aimed at the local PostgreSQL would
> silently destroy the stale decoy while production carried on, or worse be
> "corrected" later and destroy the real one.

On RDS you cannot `dropdb` the database the app connects to (and there is no
`postgres` OS user to `sudo` to). Reset the schema in place instead — this is
the managed-Postgres equivalent of drop-and-recreate, and `foodies_user` owns
the schema so it has the rights:

```bash
pm2 stop foodies-backend

# with the PG* variables exported (see Database connection)
psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

### Custom-format dump (`pg_dump -Fc`) (`.dump` / `.backup`)

```bash
pg_restore --no-owner --role="$PGUSER" -d "$PGDATABASE" ~/db-backups/foodies_<stamp>.dump
```

### Plain SQL file (`.sql`)

```bash
psql -f ~/foodies.sql
```

`--no-owner --role=` matters: a dump may carry ownership from a different role,
and without these flags the app can end up unable to write to its own tables.

### After restore: fix ownership/privileges (common requirement)

Some backups restore objects owned by another role. If your app connects as `foodies_user`, make sure it can read/write tables:

```bash
psql -c "ALTER SCHEMA public OWNER TO foodies_user;"
psql -c "GRANT ALL ON SCHEMA public TO foodies_user;"

psql -c "
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO foodies_user', r.schemaname, r.tablename);
  END LOOP;
END
\$\$;"

psql -c "
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

## Backend build failed after `npm audit fix` (corrupted `node_modules`)

**Do not run `npm audit fix` on the EC2 production server.** It can leave `node_modules` half-updated (`ENOTEMPTY`) and break `nest build` with errors like `Cannot find module 'lodash/toArray'`.

**Recovery** (run on EC2 while the app is briefly down):

```bash
cd ~/foodies/backend
pm2 stop foodies-backend

rm -rf node_modules
npm install --legacy-peer-deps
npm run build

pm2 start foodies-backend --update-env
# or: pm2 restart foodies-backend --update-env

pm2 logs foodies-backend --lines 20
```

Confirm Firebase (if configured): log line `Firebase Admin SDK initialized successfully.`

Use `npm ci` instead of `npm install` only if `package-lock.json` is committed and in sync with `package.json` on the server.

---

## Firebase credentials from mobile dev (text only, no JSON file)

If you only have **project id**, **client email**, and **private key** as chat text (not a downloaded `.json`):

1. Put them in `~/foodies/backend/.env`:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

Rules for `FIREBASE_PRIVATE_KEY`:

- One line in `.env`, wrapped in **double quotes**.
- Use literal `\n` between PEM lines (not real line breaks in the file).
- Must include `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` (with spaces).
- If mobile dev sent only the long base64 block, paste that alone — the build script adds BEGIN/END headers.

2. **Either** rely on `.env` only (leave `FIREBASE_PRIVATE_KEY_PATH` unset), **or** generate a real JSON file on EC2:

```bash
cd ~/foodies/backend
node scripts/build-firebase-service-account-json.mjs /home/ubuntu/secrets/firebase-service-account.json
head -c 2 /home/ubuntu/secrets/firebase-service-account.json   # must print: {
```

3. `pm2 restart foodies-backend --update-env`

**Do not** save raw PEM text into `firebase-service-account.json` — that file must be JSON starting with `{`.

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

Use your latest verified dump from `~/db-backups/`. Export the `PG*` variables
first (see **Database connection**) and confirm you are on RDS — these commands
destroy whatever database they are pointed at:

```bash
pm2 stop foodies-backend
psql -c "SELECT current_database(), inet_server_addr();"   # must show RDS
psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pg_restore --no-owner --role="$PGUSER" -d "$PGDATABASE" ~/db-backups/foodies_YYYY-MM-DD_HHMM.dump
pm2 start foodies-backend
pm2 logs foodies-backend --lines 50
```

A rollback only returns you to the schema **as of that dump**. If the dump was
taken after the migrations ran, restoring it does not undo them — check what the
dump actually contains before relying on it:

```bash
pg_restore -l ~/db-backups/foodies_YYYY-MM-DD_HHMM.dump | grep -c "TABLE DATA"
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

