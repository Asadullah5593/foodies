import React from 'react';

/**
 * Edits a size→number map (e.g. per-size topping price {"7":99,"12":249} or
 * per-size included-free count {"7":2,"12":3}) as a small grid of size-key / value rows.
 * Emits null when empty so the backend stores NULL and the flat fallback applies.
 */
export interface SizeMapEditorProps {
  label: string;
  /** Header for the numeric column, e.g. "Price" or "Free". */
  valueLabel: string;
  value: Record<string, number> | null | undefined;
  onChange: (next: Record<string, number> | null) => void;
  /** Quick-add buttons for common size keys (e.g. ['7','10','12','14']). */
  suggestedKeys?: string[];
  hint?: string;
}

type Row = { key: string; value: string };

const toRows = (map: Record<string, number> | null | undefined): Row[] =>
  map ? Object.entries(map).map(([k, v]) => ({ key: k, value: String(v) })) : [];

const rowsToMap = (rows: Row[]): Record<string, number> | null => {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = r.key.trim();
    const n = Number(r.value);
    if (!k || !Number.isFinite(n) || n < 0) continue;
    out[k] = n;
  }
  return Object.keys(out).length ? out : null;
};

const SizeMapEditor: React.FC<SizeMapEditorProps> = ({
  label,
  valueLabel,
  value,
  onChange,
  suggestedKeys = [],
  hint,
}) => {
  // Local row state so partially-typed rows don't get dropped on each keystroke.
  const [rows, setRows] = React.useState<Row[]>(() => toRows(value));
  // Re-sync when the editing target changes (value identity changes).
  const lastSerialized = React.useRef(JSON.stringify(value ?? null));
  React.useEffect(() => {
    const s = JSON.stringify(value ?? null);
    if (s !== lastSerialized.current && s !== JSON.stringify(rowsToMap(rows))) {
      setRows(toRows(value));
    }
    lastSerialized.current = s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: Row[]) => {
    setRows(next);
    const map = rowsToMap(next);
    lastSerialized.current = JSON.stringify(map);
    onChange(map);
  };

  const setRow = (i: number, patch: Partial<Row>) =>
    commit(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = (key = '') => commit([...rows, { key, value: '' }]);
  const removeRow = (i: number) => commit(rows.filter((_, idx) => idx !== i));

  const usedKeys = new Set(rows.map((r) => r.key.trim()));

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {rows.length > 0 && (
        <div className="space-y-2 mb-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={r.key}
                onChange={(e) => setRow(i, { key: e.target.value })}
                placeholder="size"
                className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={r.value}
                onChange={(e) => setRow(i, { value: e.target.value })}
                placeholder={valueLabel}
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="px-2 py-1 text-sm text-red-600 hover:bg-red-50 rounded"
                aria-label="Remove size"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {suggestedKeys
          .filter((k) => !usedKeys.has(k))
          .map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => addRow(k)}
              className="px-2 py-1 text-xs border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              + {k}"
            </button>
          ))}
        <button
          type="button"
          onClick={() => addRow()}
          className="px-2 py-1 text-xs border border-dashed border-gray-400 rounded-lg hover:bg-gray-50"
        >
          + Add size
        </button>
      </div>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
};

export default SizeMapEditor;
