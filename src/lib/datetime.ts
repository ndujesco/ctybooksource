/* ---------------------------------------------------------------------------
   Dates are stored as plain "yyyy-mm-dd" strings, not Date objects.

   The business runs in one timezone (WAT). Storing the business date as a
   string means "today's sales" is a string comparison instead of a UTC-offset
   argument, and range filters/grouping become substring work.
   ------------------------------------------------------------------------ */

export type Period = "today" | "week" | "month" | "year" | "all" | "custom";

export type Range = { from: string; to: string }; // inclusive both ends

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return ymd(new Date());
}

export function parseYmd(s: string): Date {
  const [y, m, d] = (s || "").split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

export function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function daysBetween(from: string, to: string): number {
  const ms = parseYmd(to).getTime() - parseYmd(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Whole days from `date` until today. Negative means it's in the future. */
export function daysAgo(date: string): number {
  return daysBetween(date, today());
}

/** The range a named period covers, relative to today. */
export function periodRange(period: Period, custom?: Partial<Range>): Range {
  const now = new Date();
  const t = ymd(now);
  switch (period) {
    case "today":
      return { from: t, to: t };
    case "week": {
      // Week starts Monday.
      const dow = (now.getDay() + 6) % 7;
      return { from: addDays(t, -dow), to: t };
    }
    case "month":
      return { from: `${t.slice(0, 7)}-01`, to: t };
    case "year":
      return { from: `${t.slice(0, 4)}-01-01`, to: t };
    case "all":
      return { from: "1970-01-01", to: t };
    case "custom":
      return {
        from: isYmd(custom?.from) ? custom!.from! : `${t.slice(0, 7)}-01`,
        to: isYmd(custom?.to) ? custom!.to! : t,
      };
  }
}

/**
 * The equivalent stretch of time immediately before `range`, for growth
 * comparisons ("this month vs last month").
 */
export function previousRange(range: Range): Range {
  const span = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -span), to: addDays(range.from, -1) };
}

/** How a period's series should be bucketed on the chart. */
export type Bucket = "day" | "week" | "month";

export function bucketFor(range: Range): Bucket {
  const span = daysBetween(range.from, range.to) + 1;
  if (span <= 31) return "day";
  if (span <= 180) return "week";
  return "month";
}

/** Key a date into its bucket. Weeks key to their Monday. */
export function bucketKey(date: string, bucket: Bucket): string {
  if (bucket === "month") return date.slice(0, 7);
  if (bucket === "day") return date;
  const d = parseYmd(date);
  const dow = (d.getDay() + 6) % 7;
  return addDays(date, -dow);
}

/** Every bucket key across a range, so the chart shows empty days too. */
export function bucketKeys(range: Range, bucket: Bucket): string[] {
  const keys: string[] = [];
  let cursor = bucketKey(range.from, bucket);
  const end = bucketKey(range.to, bucket);
  let guard = 0;
  while (cursor <= end && guard++ < 1000) {
    keys.push(cursor);
    if (bucket === "day") cursor = addDays(cursor, 1);
    else if (bucket === "week") cursor = addDays(cursor, 7);
    else {
      const [y, m] = cursor.split("-").map(Number);
      const next = new Date(y, m, 1); // month is 0-indexed, so this is next month
      cursor = ymd(next).slice(0, 7);
    }
  }
  return keys;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "14 Aug 2026" */
export function formatDate(date: string): string {
  if (!isYmd(date)) return date || "";
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Short axis/table label for a bucket key. */
export function formatBucket(key: string, bucket: Bucket): string {
  if (bucket === "month") {
    const [y, m] = key.split("-").map(Number);
    return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
  }
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "August 2026" */
export function formatMonthLong(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const long = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${long[m - 1]} ${y}`;
}

/** "today" / "yesterday" / "12 days ago" */
export function relativeDays(date: string): string {
  if (!isYmd(date)) return "never";
  const n = daysAgo(date);
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 0) return `in ${-n} days`;
  return `${n} days ago`;
}

export function formatRange(r: Range): string {
  if (r.from === r.to) return formatDate(r.from);
  return `${formatDate(r.from)} – ${formatDate(r.to)}`;
}
