/* ---------------------------------------------------------------------------
   Publisher spines.

   Every book on a shelf is found by the colour of its spine. Each publisher
   gets one colour, derived from its name, and keeps it everywhere: the bar
   beside a book in the catalogue, the bar beside a line on an invoice, and the
   series colour in the publisher charts. Same publisher, same colour, always —
   colour follows the entity, never its rank.
   ------------------------------------------------------------------------ */

export const SPINE_COLORS = [
  "#2563c9",
  "#d97706",
  "#0e9488",
  "#8b5cf6",
  "#be2e62",
  "#a16207",
  "#0891b2",
  "#9a3412",
] as const;

const UNKNOWN = "#a8b0be"; // no publisher recorded — deliberately colourless

export function spineColor(publisher: string | null | undefined): string {
  const key = (publisher || "").trim().toLowerCase();
  if (!key) return UNKNOWN;
  // FNV-1a: stable across reloads and machines, so a publisher's colour never
  // shifts between the invoice screen and the reports screen.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return SPINE_COLORS[hash % SPINE_COLORS.length];
}

/** Debt-ageing ramp — one hue, darkening with age. Index 0 is newest. */
export const AGE_COLORS = ["#e8a29b", "#d9736a", "#c24a3f", "#8f2a22"] as const;
