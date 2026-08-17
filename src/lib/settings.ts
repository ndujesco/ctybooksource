// Device-level settings, persisted in localStorage (this app has no auth).

export type Business = {
  name: string;
  phone: string;
  email: string;
  address: string;
};

export type HeaderToggles = {
  name: boolean;
  phone: boolean;
  email: boolean;
  address: boolean;
};

export const DEFAULT_BUSINESS: Business = {
  name: "CTY Booksource",
  phone: "",
  email: "",
  address: "",
};

export const DEFAULT_TOGGLES: HeaderToggles = {
  name: true,
  phone: true,
  email: false,
  address: true,
};

export const FONT_STEPS = [0.9, 1, 1.1, 1.25, 1.4] as const;

const K_BUSINESS = "pb.business";
const K_TOGGLES = "pb.headerToggles";
const K_FONT = "pb.fontScale";

/* Snapshots are cached and only replaced when a setting actually changes.
   `useSyncExternalStore` compares snapshots by reference, so re-parsing the
   JSON on every read would spin forever. */
const snapshots = new Map<string, unknown>();
const listeners = new Set<() => void>();

export function subscribeToSettings(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab editing settings should update this one too.
  const onStorage = () => invalidate();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function invalidate() {
  snapshots.clear();
  for (const l of listeners) l();
}

function read<T extends object>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const cached = snapshots.get(key);
  if (cached) return cached as T;
  let value = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw) value = { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    /* corrupt entry — fall back to the default */
  }
  snapshots.set(key, value);
  return value;
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  invalidate();
}

export const getBusiness = () => read(K_BUSINESS, DEFAULT_BUSINESS);
export const setBusiness = (b: Business) => write(K_BUSINESS, b);

export const getToggles = () => read(K_TOGGLES, DEFAULT_TOGGLES);
export const setToggles = (t: HeaderToggles) => write(K_TOGGLES, t);

export function getFontScale(): number {
  if (typeof window === "undefined") return 1;
  const v = parseFloat(localStorage.getItem(K_FONT) || "1");
  return Number.isFinite(v) ? v : 1;
}

export function setFontScale(scale: number) {
  try {
    localStorage.setItem(K_FONT, String(scale));
  } catch {}
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--font-scale", String(scale));
  }
  invalidate();
}

