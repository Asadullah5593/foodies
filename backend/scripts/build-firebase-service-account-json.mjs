#!/usr/bin/env node
/**
 * Build a valid Firebase service-account JSON from backend/.env text fields.
 * Use when you only have project_id, client_email, and private_key as text (no .json download).
 *
 * Usage (from backend/):
 *   node scripts/build-firebase-service-account-json.mjs /home/ubuntu/secrets/firebase-service-account.json
 *   node scripts/build-firebase-service-account-json.mjs   # prints to stdout
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');
const envPath = resolve(backendRoot, '.env');

function loadEnvFile(path) {
    if (!existsSync(path)) return;
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

function normalizePrivateKey(raw) {
    if (!raw) return null;
    let key = raw.trim();
    if (!key) return null;
    key = key.replace(/\\n/g, '\n');
    if (!key.includes('BEGIN PRIVATE KEY')) {
        const body = key.replace(/\s+/g, '');
        if (!body) return null;
        const lines = body.match(/.{1,64}/g) || [body];
        key = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
    }
    if (!key.endsWith('\n')) key += '\n';
    return key;
}

loadEnvFile(envPath);

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

if (!projectId || !clientEmail || !privateKey) {
    console.error(
        'Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY in backend/.env',
    );
    process.exit(1);
}

const serviceAccount = {
    type: 'service_account',
    project_id: projectId,
    private_key: privateKey,
    client_email: clientEmail,
};

const json = JSON.stringify(serviceAccount, null, 2);
const outPath = process.argv[2];

if (outPath) {
    writeFileSync(outPath, json, { mode: 0o600 });
    console.log(`Wrote ${outPath} (${json.length} bytes)`);
    console.log('Validate: head -c 2', outPath, '→ should be "{\\n"');
} else {
    process.stdout.write(json);
}
