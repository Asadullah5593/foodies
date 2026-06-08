# Hosting `app.foodies-pakistan.com` on AWS (S3 + CloudFront)

This subdomain exists for **one purpose**: serve the mobile app's deep-link
association files and a store-redirect fallback page. It is intentionally
separate from the main `foodies-pakistan.com` website so the app only claims
links on this subdomain.

It must serve, over **HTTPS** with **200 OK** (no 301/302 on the JSON content):

| URL | Content-Type | Source file |
|-----|--------------|-------------|
| `/.well-known/assetlinks.json` | `application/json` | Android verification |
| `/.well-known/apple-app-site-association` | `application/json` | iOS verification (no extension!) |
| `/` and any unmatched path (`/menu`, ...) | `text/html` | `index.html` store-redirect fallback |

Architecture: **Route 53** (DNS) → **CloudFront** (HTTPS + CDN) → **S3** (private origin via OAC).

---

## Prerequisites

- The `foodies-pakistan.com` **hosted zone already exists in Route 53**
  (it must, since the main site resolves). We only add one record to it.
- AWS CLI v2 installed and configured (`aws sts get-caller-identity` works).
- Pick a region for the bucket, e.g. `ap-south-1` (Mumbai, closest to PK).
  **The ACM certificate, however, MUST be in `us-east-1`** — CloudFront only
  reads certs from there. This trips everyone up.

Set these once in your shell:

```bash
export BUCKET=app-foodies-pakistan-com      # globally-unique bucket name
export REGION=ap-south-1                     # bucket region
export DOMAIN=app.foodies-pakistan.com
```

---

## Step 1 — Create the S3 bucket and upload the files

```bash
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

# Keep the bucket fully private; CloudFront reaches it via Origin Access Control.
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Upload with correct Content-Types (this is what deploy.sh does):
BUCKET="$BUCKET" ./deploy.sh
```

> Why `deploy.sh` and not a plain `aws s3 sync`? The `apple-app-site-association`
> file has no extension, so sync would tag it `application/octet-stream` and iOS
> would ignore it. The script forces `application/json` on both well-known files.

---

## Step 2 — Request the TLS certificate (in us-east-1!)

```bash
aws acm request-certificate \
  --region us-east-1 \
  --domain-name "$DOMAIN" \
  --validation-method DNS
```

Then in the ACM console (us-east-1) open the cert and click
**"Create records in Route 53"** to auto-add the validation CNAME. Wait until
status = **Issued** (usually a few minutes). Note the cert ARN.

---

## Step 3 — Create the CloudFront distribution (console is easiest for this one)

CloudFront → **Create distribution**:

- **Origin domain**: pick your bucket from the dropdown — choose the
  `...s3.amazonaws.com` **REST** endpoint, NOT the "website endpoint".
- **Origin access**: *Origin access control settings (recommended)* →
  **Create new OAC** → accept defaults. After the distribution is created,
  CloudFront shows a **bucket policy to copy** — paste it into
  S3 → your bucket → Permissions → Bucket policy. (It grants
  `s3:GetObject` only to this distribution.)
- **Viewer protocol policy**: *Redirect HTTP to HTTPS*.
  (This only redirects the scheme for browsers; Apple/Google fetch the JSON
  over HTTPS directly, so they never see a redirect on the file itself.)
- **Default root object**: `index.html`
- **Alternate domain name (CNAME)**: `app.foodies-pakistan.com`
- **Custom SSL certificate**: select the ACM cert from Step 2.
- **Custom error responses** (add two — this is what makes unmatched deep
  links like `/menu` fall back to the redirect page with a real 200):
  - HTTP 403 → Response page path `/index.html` → HTTP Response code **200**
  - HTTP 404 → Response page path `/index.html` → HTTP Response code **200**

The `.well-known` files exist in the bucket, so they return their real JSON
with a 200 directly — the error-response rule never touches them.

Create it and wait for **Deployed** (~5–10 min). Note the distribution domain
(`dxxxx.cloudfront.net`) and the **Distribution ID** (`E…`).

---

## Step 4 — Point the subdomain at CloudFront (Route 53)

Route 53 → hosted zone `foodies-pakistan.com` → **Create record**:

- Record name: `app`
- Type: `A`
- **Alias**: ON → route traffic to **CloudFront distribution** → pick yours.
- Also add an `AAAA` alias record (same target) for IPv6.

---

## Step 5 — Verify (do this before telling the mobile team it's live)

```bash
# Both must return HTTP/2 200 AND content-type: application/json
curl -sSI https://app.foodies-pakistan.com/.well-known/assetlinks.json \
  | grep -iE "^(HTTP|content-type)"
curl -sSI https://app.foodies-pakistan.com/.well-known/apple-app-site-association \
  | grep -iE "^(HTTP|content-type)"

# Should print the raw JSON, no redirect:
curl -sS https://app.foodies-pakistan.com/.well-known/apple-app-site-association

# Fallback page should return 200 + text/html for an arbitrary deep-link path:
curl -sSI https://app.foodies-pakistan.com/menu | grep -iE "^(HTTP|content-type)"
```

Official validators:
- Android: https://developers.google.com/digital-asset-links/tools/generator
  (or `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.foodies-pakistan.com&relation=delegate_permission/common.handle_all_urls`)
- Apple: https://app-site-association.cdn-apple.com/a/v1/app.foodies-pakistan.com
  (Apple's CDN cache — may take a while to populate after go-live)

---

## Updating the files later

When the mobile team sends new association files, replace them in this folder
and re-run (the `DISTRIBUTION_ID` triggers a cache invalidation so it's live
immediately):

```bash
BUCKET=app-foodies-pakistan-com DISTRIBUTION_ID=E1XXXXXXXXXX ./deploy.sh
```

---

## Gotchas checklist

- [ ] ACM cert is in **us-east-1** (not your bucket region).
- [ ] AASA file served as **application/json** (verify with curl above).
- [ ] No 301/302 on the JSON files themselves.
- [ ] Bucket stays **private**; access only via CloudFront OAC.
- [ ] `app.foodies-pakistan.com` is on the cert **and** the CloudFront CNAME.
- [ ] The SHA-256 fingerprint / Team ID in the files match YOUR real app
      signing key — confirm with the mobile dev before go-live.
