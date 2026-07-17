/**
 * Client for the Foodies print agent (see `print-agent/`).
 *
 * A browser cannot choose a printer — window.print() goes wherever the dialog
 * says — so sending the customer invoice to one printer and the KOT to another,
 * with no dialog, needs the local agent. When it is not installed every call
 * here reports "unavailable" and the caller falls back to the print dialog, so
 * a terminal without the agent behaves exactly as it always has.
 */

const DEFAULT_PORT = 9787;
const AGENT_BASE = `http://127.0.0.1:${DEFAULT_PORT}`;
/** The agent is local; a job that stalls should surface fast, not hang the till. */
const TIMEOUT_MS = 20000;

export interface AgentPrinter {
  name: string;
  isDefault: boolean;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${AGENT_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body?.error || `Print agent error (${res.status})`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** True when the agent is installed and answering on this terminal. */
export async function isAgentAvailable(): Promise<boolean> {
  try {
    const { ok } = await call<{ ok: boolean }>('/health');
    return ok === true;
  } catch {
    return false;
  }
}

/** Printers installed on this terminal, as the OS reports them. */
export async function getAgentPrinters(): Promise<AgentPrinter[]> {
  const { printers } = await call<{ printers: AgentPrinter[] }>('/printers');
  return printers ?? [];
}

/**
 * Print rendered invoice HTML to a named printer, with no dialog.
 * `widthMm` is the receipt roll width — the agent sizes the page to it, since a
 * browser-default page would be scaled or clipped by the thermal driver.
 */
export async function printViaAgent(job: {
  html: string;
  css?: string;
  printer: string;
  title?: string;
  widthMm?: number;
  copies?: number;
}): Promise<void> {
  await call('/print', { method: 'POST', body: JSON.stringify(job) });
}
