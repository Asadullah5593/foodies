const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parse = (s?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};

/**
 * A date range as a short chip label for the phone filter bar: "9 Jun – 8 Oct", "9 Jun",
 * "From 9 Jun", "Up to 8 Oct". The year is added only when it isn't the current one or the two
 * ends fall in different years.
 */
export function rangeChipLabel(from?: string | null, to?: string | null, now: Date = new Date()): string {
  const a = parse(from);
  const b = parse(to);
  const thisYear = now.getFullYear();
  const fmt = (x: { y: number; m: number; d: number }, withYear: boolean) =>
    `${x.d} ${MONTHS[x.m - 1]}${withYear ? ` ${x.y}` : ''}`;
  if (!a && !b) return 'All dates';
  if (a && !b) return `From ${fmt(a, a.y !== thisYear)}`;
  if (!a && b) return `Up to ${fmt(b, b.y !== thisYear)}`;
  const showYear = a!.y !== b!.y || a!.y !== thisYear;
  if (a!.y === b!.y && a!.m === b!.m && a!.d === b!.d) return fmt(a!, showYear);
  return `${fmt(a!, showYear)} – ${fmt(b!, showYear)}`;
}
