#!/usr/bin/env node
/**
 * Foodies print agent — silent printing to a NAMED printer.
 *
 * Browsers cannot choose a printer: window.print() always goes to whatever the
 * user picks in the dialog, and nothing in the web platform enumerates printers.
 * That makes "customer invoice to printer A, KOT to printer B, no dialog"
 * impossible from the page alone. This agent closes that gap: it runs on the POS
 * terminal, the page POSTs it rendered invoice HTML plus a printer name, and it
 * prints through the OS spooler with no dialog.
 *
 *   GET  /health            -> { ok, version, platform }
 *   GET  /printers          -> { printers: [{ name, isDefault }], default }
 *   POST /print             -> { html, css?, printer, title?, widthMm?, copies? }
 *
 * HTML -> PDF uses the browser already on the machine (Edge on Windows, Chrome
 * on Linux) in headless mode, so nothing bundles a second Chromium. The PDF then
 * goes to the spooler: SumatraPDF/pdf-to-printer on Windows, lp on Linux.
 */
const http = require('http');
const net = require('net');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);

const VERSION = '1.0.0';
const PORT = Number(process.env.FOODIES_AGENT_PORT || 9787);
const HOST = '127.0.0.1'; // localhost only — never expose this to the network
/**
 * Origins allowed to drive this agent. The page runs in the cashier's browser,
 * so the agent must accept cross-origin calls from the POS — but only from the
 * POS. Set FOODIES_AGENT_ORIGINS to a comma list to add production origins.
 */
const ALLOWED_ORIGINS = new Set(
    (
        process.env.FOODIES_AGENT_ORIGINS ||
        'http://localhost:3000,http://127.0.0.1:3000'
    )
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
);

const isWindows = process.platform === 'win32';
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ------------------------------------------------------------------ browser */

const WINDOWS_BROWSERS = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const UNIX_BROWSERS = [
    'google-chrome',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
];

let cachedBrowser = null;
async function findBrowser() {
    if (cachedBrowser) return cachedBrowser;
    if (process.env.FOODIES_AGENT_BROWSER) {
        cachedBrowser = process.env.FOODIES_AGENT_BROWSER;
        return cachedBrowser;
    }
    if (isWindows) {
        for (const exe of WINDOWS_BROWSERS) {
            try {
                await fs.access(exe);
                cachedBrowser = exe;
                return exe;
            } catch {
                /* try next */
            }
        }
    } else {
        for (const bin of UNIX_BROWSERS) {
            try {
                const { stdout } = await execFileAsync('which', [bin]);
                if (stdout.trim()) {
                    cachedBrowser = stdout.trim();
                    return cachedBrowser;
                }
            } catch {
                /* try next */
            }
        }
    }
    throw new Error(
        'No Chrome/Edge found for HTML rendering. Install Microsoft Edge (ships with Windows 10/11) or set FOODIES_AGENT_BROWSER to a browser executable.',
    );
}

/* ---------------------------------------------------------------- devtools */

/** A free localhost port for the headless browser's debugging endpoint. */
function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

/** Poll the browser's HTTP endpoint until a page target is attachable. */
async function waitForTarget(port, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let lastErr;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`);
            const targets = await res.json();
            const page = targets.find(
                (t) => t.type === 'page' && t.webSocketDebuggerUrl,
            );
            if (page) return page.webSocketDebuggerUrl;
        } catch (e) {
            lastErr = e;
        }
        await new Promise((r) => setTimeout(r, 120));
    }
    throw new Error(
        `Headless browser did not come up: ${lastErr?.message ?? 'no page target'}`,
    );
}

/** Minimal DevTools client over Node's built-in WebSocket — no dependencies. */
const CDP = {
    async connect(wsUrl) {
        const ws = new WebSocket(wsUrl);
        await new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve, { once: true });
            ws.addEventListener('error', () => reject(new Error('CDP connect failed')), { once: true });
        });
        let nextId = 1;
        const pending = new Map();
        const listeners = new Map();
        ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                msg.error
                    ? reject(new Error(msg.error.message))
                    : resolve(msg.result);
            } else if (msg.method && listeners.has(msg.method)) {
                listeners.get(msg.method).forEach((fn) => fn(msg.params));
                listeners.delete(msg.method);
            }
        });
        return {
            send(method, params = {}) {
                const id = nextId++;
                return new Promise((resolve, reject) => {
                    pending.set(id, { resolve, reject });
                    ws.send(JSON.stringify({ id, method, params }));
                    setTimeout(
                        () =>
                            pending.has(id) &&
                            (pending.delete(id),
                            reject(new Error(`${method} timed out`))),
                        30000,
                    );
                });
            },
            waitFor(method, timeoutMs) {
                return new Promise((resolve, reject) => {
                    const arr = listeners.get(method) ?? [];
                    arr.push(resolve);
                    listeners.set(method, arr);
                    setTimeout(
                        () => reject(new Error(`${method} timed out`)),
                        timeoutMs,
                    );
                });
            },
            close: () => ws.close(),
        };
    },
};

/* ----------------------------------------------------------------- printers */

/** Installed printers, with the default flagged. */
async function listPrinters() {
    if (isWindows) {
        // -NoProfile keeps a user's PowerShell profile from polluting stdout.
        const { stdout } = await execFileAsync(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress',
            ],
            { windowsHide: true, maxBuffer: 1024 * 1024 },
        );
        const raw = JSON.parse(stdout.trim() || '[]');
        // ConvertTo-Json emits an object (not an array) for a single printer.
        const rows = Array.isArray(raw) ? raw : [raw];
        return rows
            .filter((r) => r && r.Name)
            .map((r) => ({ name: r.Name, isDefault: Boolean(r.Default) }));
    }
    const { stdout } = await execFileAsync('lpstat', ['-p', '-d']);
    const printers = [];
    let def = null;
    for (const line of stdout.split('\n')) {
        const m = /^printer\s+(\S+)/.exec(line);
        if (m) printers.push(m[1]);
        const d = /^system default destination:\s*(\S+)/.exec(line);
        if (d) def = d[1];
    }
    return printers.map((name) => ({ name, isDefault: name === def }));
}

/* -------------------------------------------------------------------- print */

/** Wrap the invoice fragment in a bare page; the paper size is set at print time. */
function buildDocument({ html, css = '', title = 'Print' }) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${String(title).replace(/[<&>]/g, '')}</title>
<style>
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  ${css}
</style>
</head>
<body>${html}</body>
</html>`;
}

const MM_PER_IN = 25.4;
const PX_PER_IN = 96; // CSS reference pixel

/**
 * Render to PDF over the DevTools protocol rather than `--print-to-pdf`.
 *
 * The CLI flag gives no control over paper size and ignores @page: a receipt
 * comes out on US Letter, which a thermal driver then scales or clips. (`size:
 * 80mm auto` cannot rescue it either — one length in @page means BOTH
 * dimensions, and `auto` may not pair with a length, so the rule is dropped.)
 *
 * printToPDF takes an explicit paper size, so the width is exact. The height is
 * measured from the laid-out document, giving a single page exactly as long as
 * the receipt — a fixed tall page would feed (and cut) blank roll instead.
 */
async function htmlToPdf(doc, jobDir, widthMm) {
    const htmlPath = path.join(jobDir, 'job.html');
    const pdfPath = path.join(jobDir, 'job.pdf');
    await fs.writeFile(htmlPath, doc, 'utf8');
    const browser = await findBrowser();
    const port = await freePort();
    const child = spawn(
        browser,
        [
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            `--remote-debugging-port=${port}`,
            `file://${htmlPath}`,
        ],
        { stdio: 'ignore', windowsHide: true },
    );
    try {
        const target = await waitForTarget(port);
        const cdp = await CDP.connect(target);
        try {
            await cdp.send('Page.enable');
            // The page is already navigating from argv; give it a moment to settle.
            await cdp
                .waitFor('Page.loadEventFired', 10000)
                .catch(() => undefined);
            const widthPx = widthMm
                ? (Number(widthMm) / MM_PER_IN) * PX_PER_IN
                : null;
            if (widthPx) {
                // Lay the document out at the roll width before measuring. The
                // viewport is deliberately 1px tall: scrollHeight never reports
                // less than the viewport, so a tall one would measure itself
                // and feed that much blank roll.
                await cdp.send('Emulation.setDeviceMetricsOverride', {
                    width: Math.round(widthPx),
                    height: 1,
                    deviceScaleFactor: 1,
                    mobile: false,
                });
            }
            const { result } = await cdp.send('Runtime.evaluate', {
                expression: `Math.ceil(Math.max(
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight,
                    document.body.getBoundingClientRect().height
                ))`,
                returnByValue: true,
            });
            const heightPx = Number(result?.value) || 0;
            const params = {
                printBackground: true,
                marginTop: 0,
                marginBottom: 0,
                marginLeft: 0,
                marginRight: 0,
                preferCSSPageSize: false,
            };
            if (widthMm) {
                params.paperWidth = Number(widthMm) / MM_PER_IN;
                // +2mm so a fractional last line is never pushed onto page 2.
                params.paperHeight = Math.max(
                    0.4,
                    heightPx / PX_PER_IN + 2 / MM_PER_IN,
                );
            }
            const { data } = await cdp.send('Page.printToPDF', params);
            await fs.writeFile(pdfPath, Buffer.from(data, 'base64'));
        } finally {
            cdp.close();
        }
    } finally {
        child.kill();
    }
    return pdfPath;
}

async function printPdf(pdfPath, printer, copies = 1) {
    // Dry run: write the rendered PDF here and skip the spooler. Set
    // FOODIES_AGENT_CAPTURE=/path/job.pdf to inspect exactly what would print
    // (paper size, layout) without paper — used to verify receipt geometry.
    if (process.env.FOODIES_AGENT_CAPTURE) {
        await fs.copyFile(pdfPath, process.env.FOODIES_AGENT_CAPTURE);
        log(`captured -> ${process.env.FOODIES_AGENT_CAPTURE} (not printed)`);
        return;
    }
    if (isWindows) {
        // SumatraPDF ships with pdf-to-printer and prints silently to a named
        // printer; -print-settings noscale keeps the receipt at exact width.
        const sumatra = require.resolve(
            'pdf-to-printer/dist/SumatraPDF-3.4.6-32.exe',
        );
        for (let i = 0; i < copies; i++) {
            await execFileAsync(
                sumatra,
                [
                    '-print-to',
                    printer,
                    '-print-settings',
                    'noscale',
                    '-silent',
                    '-exit-when-done',
                    pdfPath,
                ],
                { timeout: 60000, windowsHide: true },
            );
        }
        return;
    }
    await execFileAsync('lp', [
        '-d',
        printer,
        '-n',
        String(copies),
        '-o',
        'fit-to-page=false',
        pdfPath,
    ]);
}

async function handlePrint(body) {
    const { html, css, printer, title, widthMm, copies } = body ?? {};
    if (!html || typeof html !== 'string')
        throw new HttpError(400, 'html is required');
    if (!printer || typeof printer !== 'string')
        throw new HttpError(400, 'printer is required');

    // Only ever print to a printer this machine actually has: the name arrives
    // from the browser and is passed to the spooler.
    const printers = await listPrinters();
    if (!printers.some((p) => p.name === printer)) {
        throw new HttpError(
            400,
            `Unknown printer "${printer}". Available: ${printers.map((p) => p.name).join(', ') || 'none'}`,
        );
    }

    const jobDir = await fs.mkdtemp(
        path.join(os.tmpdir(), `foodies-print-${crypto.randomUUID()}-`),
    );
    try {
        const pdf = await htmlToPdf(
            buildDocument({ html, css, title }),
            jobDir,
            widthMm,
        );
        await printPdf(pdf, printer, Math.min(5, Math.max(1, Number(copies) || 1)));
        log(`printed "${title ?? 'Print'}" -> ${printer}`);
        return { ok: true, printer };
    } finally {
        await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    }
}

/* ------------------------------------------------------------------- server */

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const readJson = (req) =>
    new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (c) => {
            raw += c;
            if (raw.length > 5_000_000) {
                reject(new HttpError(413, 'Payload too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch {
                reject(new HttpError(400, 'Invalid JSON'));
            }
        });
        req.on('error', reject);
    });

const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Private Network Access: a page on a public origin (the POS over HTTPS)
    // reaching a loopback address is preflighted by Chrome, which then demands
    // this header. Without it production prints nothing while localhost is fine.
    if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
    }
    // A page from an unlisted origin gets no CORS header, so the browser blocks
    // the read anyway — reject outright so it cannot cause a print either.
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({ error: `Origin ${origin} is not allowed` }),
        );
        return;
    }

    const send = (status, payload) =>
        res
            .writeHead(status, { 'Content-Type': 'application/json' })
            .end(JSON.stringify(payload));

    const url = (req.url || '').split('?')[0];
    const route = async () => {
        if (req.method === 'GET' && url === '/health') {
            return {
                ok: true,
                version: VERSION,
                platform: process.platform,
            };
        }
        if (req.method === 'GET' && url === '/printers') {
            const printers = await listPrinters();
            return {
                printers,
                default: printers.find((p) => p.isDefault)?.name ?? null,
            };
        }
        if (req.method === 'POST' && url === '/print') {
            return handlePrint(await readJson(req));
        }
        throw new HttpError(404, 'Not found');
    };

    route()
        .then((payload) => send(200, payload))
        .catch((err) => {
            const status = err instanceof HttpError ? err.status : 500;
            if (status >= 500) log('ERROR', err.message);
            send(status, { error: err.message || 'Print agent error' });
        });
});

server.listen(PORT, HOST, () => {
    log(`Foodies print agent ${VERSION} on http://${HOST}:${PORT}`);
    log(`Allowed origins: ${[...ALLOWED_ORIGINS].join(', ')}`);
    findBrowser()
        .then((b) => log(`Renderer: ${b}`))
        .catch((e) => log(`WARNING: ${e.message}`));
    listPrinters()
        .then((p) =>
            log(
                `Printers: ${p.map((x) => x.name + (x.isDefault ? ' (default)' : '')).join(', ') || 'none found'}`,
            ),
        )
        .catch((e) => log(`WARNING: could not list printers — ${e.message}`));
});
