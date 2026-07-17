# Foodies print agent

Prints the **customer invoice** and the **KOT** to **two different printers**, with
no print dialog, on a POS terminal.

## Why this exists

A browser cannot choose a printer. `window.print()` always goes to whatever the
user picks in the dialog, and no web API lists printers or targets one — so
"invoice to printer A, KOT to printer B, silently" is impossible from the page
alone. Chrome's `--kiosk-printing` removes the dialog but only ever uses the
**default** printer, so it cannot split two documents across two printers.

This agent runs on the terminal. The POS page POSTs it the rendered invoice HTML
plus a printer name; the agent renders it and prints through the OS spooler.

If the agent is not running, the POS silently falls back to the print dialog —
nothing breaks, you just lose the automatic routing.

## Install (Windows)

1. Install [Node.js 18+](https://nodejs.org) (LTS).
2. Copy this `print-agent` folder onto the terminal, e.g. `C:\foodies\print-agent`.
3. Install dependencies (needs internet once):
   ```
   cd C:\foodies\print-agent
   npm install --omit=dev
   ```
4. Start it:
   ```
   npm start
   ```
   It prints the printers it can see. Leave the window open, or install it as a
   service (below).
5. In the POS, open any invoice → the **Customer invoice** and **Kitchen (KOT)**
   dropdowns next to *Cutter feed* now list your printers. Pick one for each.
   Saved on that terminal; set it once.

Rendering uses **Microsoft Edge**, which ships with Windows 10/11 — nothing to
install. Printing uses SumatraPDF, bundled with the `pdf-to-printer` dependency.

### Run it automatically at login

Simplest — put a shortcut in the Startup folder:

1. `Win+R` → `shell:startup`
2. Create a shortcut to:
   `C:\Program Files\nodejs\node.exe C:\foodies\print-agent\server.js`

Or install a proper Windows service with [nssm](https://nssm.cc):

```
nssm install FoodiesPrintAgent "C:\Program Files\nodejs\node.exe" "C:\foodies\print-agent\server.js"
nssm start FoodiesPrintAgent
```

## Configuration

Environment variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `FOODIES_AGENT_PORT` | `9787` | Port on `127.0.0.1`. Change it in `printAgent.ts` too. |
| `FOODIES_AGENT_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma list of POS origins allowed to print. **Add your production URL here**, e.g. `https://pos.example.com`. |
| `FOODIES_AGENT_BROWSER` | auto-detected | Full path to Edge/Chrome, if it lives somewhere unusual. |
| `FOODIES_AGENT_CAPTURE` | — | Dry run: write the PDF to this path and skip the printer. Useful for checking receipt size without paper. |

Production example:

```
set FOODIES_AGENT_ORIGINS=https://pos.example.com
npm start
```

## Production (POS served over HTTPS)

Two things change when the POS is a real HTTPS site rather than localhost:

1. **The agent must know your origin.** Set `FOODIES_AGENT_ORIGINS` to the POS
   URL exactly as the browser shows it — scheme + host, no path, no trailing
   slash. Get this wrong and every print silently falls back to the dialog.
2. **Chrome preflights public → localhost calls** (Private Network Access). The
   agent answers with `Access-Control-Allow-Private-Network: true`, so this
   works out of the box — but it is why an older build would print on localhost
   and do nothing in production.

An HTTPS page calling `http://127.0.0.1` is **not** blocked as mixed content:
loopback counts as a trustworthy origin. No certificate is needed for the agent.

## Security

- Listens on `127.0.0.1` only — never reachable from the network.
- Only the origins in `FOODIES_AGENT_ORIGINS` may call it; anything else gets a 403.
- It only prints to a printer that is actually installed; the name is checked
  against the OS list before the job is spooled.

## API

```
GET  /health    -> { ok: true, version, platform }
GET  /printers  -> { printers: [{ name, isDefault }], default }
POST /print     -> { html, css?, printer, title?, widthMm?, copies? }
```

`widthMm` is the receipt roll width (80 for an 80mm roll). It matters: the page
is sized to exactly that width and to the receipt's measured height, so the
driver neither scales the receipt nor feeds a blank Letter page. Omit it and the
browser's default page size is used.

## Troubleshooting

**Dropdowns don't appear / "Print agent not detected"**
The agent isn't running, or the POS origin isn't in `FOODIES_AGENT_ORIGINS`.
Open `http://127.0.0.1:9787/health` on the terminal — it should return `ok`.

**Receipt prints tiny, or on a big page**
The printer's paper size isn't the roll. Set the roll size in the Windows
printer properties; the agent already sends a page the exact width of the roll.

**Last line gets cut off**
Raise *Cutter feed* next to the printer dropdowns — that's the blank paper fed
past the cutter, and it is a property of the printer, not the template.

**Nothing prints and the dialog appears instead**
That is the deliberate fallback: the agent was unreachable or the job failed.
The reason is logged in the agent window and the browser console.
