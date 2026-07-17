import React from 'react';
import { getAgentPrinters, isAgentAvailable, type AgentPrinter } from '../utils/printAgent';
import { getDevicePrinter, setDevicePrinter, type PrintPurpose } from '../utils/printerSettings';

/**
 * Which printer each document goes to ON THIS TERMINAL — the setting that makes
 * "customer invoice here, KOT there, no dialog" possible.
 *
 * Only the print agent can name a printer (the browser cannot), so without it
 * this shows why printing still opens a dialog rather than offering a choice
 * that could not be honoured. Saved per device, meant to be set once.
 */
const PURPOSES: Array<{ key: PrintPurpose; label: string }> = [
  { key: 'customer', label: 'Customer invoice' },
  { key: 'kitchen', label: 'Kitchen (KOT)' },
];

const DevicePrinterSettings: React.FC = () => {
  const [agentUp, setAgentUp] = React.useState<boolean | null>(null);
  const [printers, setPrinters] = React.useState<AgentPrinter[]>([]);
  const [choice, setChoice] = React.useState<Record<PrintPurpose, string | null>>({
    customer: getDevicePrinter('customer'),
    kitchen: getDevicePrinter('kitchen'),
  });

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const up = await isAgentAvailable();
      if (!alive) return;
      setAgentUp(up);
      if (!up) return;
      try {
        const list = await getAgentPrinters();
        if (alive) setPrinters(list);
      } catch {
        if (alive) setPrinters([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pick = (purpose: PrintPurpose, name: string) => {
    const value = name || null;
    setDevicePrinter(purpose, value);
    setChoice((c) => ({ ...c, [purpose]: value }));
  };

  if (agentUp === null) return null; // still probing — don't flash a message
  if (!agentUp) {
    return (
      <span
        className="text-xs text-gray-400"
        title="A browser cannot choose a printer, so invoices open the print dialog. Install the Foodies print agent on this terminal to send the customer invoice and the KOT to their own printers automatically."
      >
        Print agent not detected — printing uses the browser dialog
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {PURPOSES.map(({ key, label }) => (
        <label key={key} className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="whitespace-nowrap">
            {label} <span className="text-gray-400">(this device)</span>
          </span>
          <select
            value={choice[key] ?? ''}
            onChange={(e) => pick(key, e.target.value)}
            aria-label={`${label} printer`}
            className="rounded-md border border-gray-300 px-2 py-1 text-gray-800 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500/30"
          >
            <option value="">Ask (browser dialog)</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
          {/* A printer that has since been unplugged or renamed would silently
              fall back to the dialog — say so rather than look configured. */}
          {choice[key] && !printers.some((p) => p.name === choice[key]) && (
            <span className="text-red-500" title="This printer is no longer installed on this terminal">
              not found
            </span>
          )}
        </label>
      ))}
    </div>
  );
};

export default DevicePrinterSettings;
