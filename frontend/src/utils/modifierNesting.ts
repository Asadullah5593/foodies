/**
 * Order modifiers for display so a conditional chooser pick (e.g. the meal-drink
 * milkshake) renders NESTED under the option that made it visible. Backends emit
 * `triggered_by` (the trigger modifier's name); anything whose trigger isn't on
 * the same line falls back to a flat row. Shared by the order view, KDS/KOT and
 * FOH so every surface reads identically.
 */
export type NestableModifier = { name?: string | null; triggered_by?: string | null };

export function orderModifiersWithNesting<T extends NestableModifier>(
  mods: T[],
): Array<{ mod: T; nested: boolean }> {
  const isChild = (m: T) =>
    !!m.triggered_by && mods.some((x) => x !== m && (x.name ?? '') === m.triggered_by);
  const out: Array<{ mod: T; nested: boolean }> = [];
  for (const m of mods) {
    if (isChild(m)) continue;
    out.push({ mod: m, nested: false });
    for (const c of mods)
      if (isChild(c) && c.triggered_by === (m.name ?? '')) out.push({ mod: c, nested: true });
  }
  return out;
}
