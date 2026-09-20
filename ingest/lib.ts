/**
 * Shared ingest helpers.
 *
 * Everything that touches a third-party server goes through `politeFetch`,
 * which serialises requests per host and keeps a fixed gap between them. We are
 * crawling a regulator's public register and thousands of small business
 * websites; going fast would be both rude and the quickest way to get blocked.
 */

const DEFAULT_GAP_MS = 1200;
const lastHit = new Map<string, number>();

export const USER_AGENT =
  "OntarioDentalDirectoryBot/0.1 (+https://example.invalid/about; contact@example.invalid)";

export async function politeFetch(
  url: string,
  init: RequestInit = {},
  gapMs = DEFAULT_GAP_MS,
): Promise<Response> {
  const host = new URL(url).host;
  const previous = lastHit.get(host) ?? 0;
  const wait = previous + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());

  return fetch(url, {
    ...init,
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/json",
      ...(init.headers ?? {}),
    },
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retry with exponential backoff. Gives up rather than hammering. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseMs = 2000, label = "request" } = {},
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === attempts - 1) break;
      const delay = baseMs * 2 ** i;
      console.warn(`  ${label} failed (attempt ${i + 1}/${attempts}), retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

/* --------------------------------------------------------- normalisation */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Canadian numbers to a single comparable form: 10 digits, no punctuation. */
export function normalizePhone(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const digits = input.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : undefined;
}

export function formatPhone(ten: string | undefined): string | undefined {
  if (!ten || ten.length !== 10) return undefined;
  return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

export function normalizePostal(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const clean = input.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(clean)
    ? `${clean.slice(0, 3)} ${clean.slice(3)}`
    : undefined;
}

const STREET_ABBREV: Array<[RegExp, string]> = [
  [/\bstreet\b/g, "st"],
  [/\bavenue\b/g, "ave"],
  [/\broad\b/g, "rd"],
  [/\bdrive\b/g, "dr"],
  [/\bboulevard\b/g, "blvd"],
  [/\bcrescent\b/g, "cres"],
  [/\bcourt\b/g, "crt"],
  [/\bplace\b/g, "pl"],
  [/\bparkway\b/g, "pkwy"],
  [/\beast\b/g, "e"],
  [/\bwest\b/g, "w"],
  [/\bnorth\b/g, "n"],
  [/\bsouth\b/g, "s"],
  [/\bsuite\b/g, "unit"],
  [/\bste\b/g, "unit"],
  [/#/g, "unit "],
];

/**
 * A comparable form of a street address.
 *
 * Used only for matching records between sources — never for display. "3630
 * Lawrence Avenue East, Suite 4" and "3630 Lawrence Ave E #4" have to collapse
 * to the same string or the same clinic appears twice in the directory.
 */
export function addressKey(input: string | undefined): string | undefined {
  if (!input) return undefined;
  let s = input.toLowerCase().replace(/[.,]/g, " ");
  for (const [pattern, replacement] of STREET_ABBREV) s = s.replace(pattern, replacement);
  return s.replace(/\s+/g, " ").trim() || undefined;
}

/** Metres between two coordinates. */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ----------------------------------------------------------- record types */

/** What every source normalises into before merging. */
export interface SourceRecord {
  source: "rcdso" | "osm";
  sourceId: string;
  name: string;
  address?: string;
  city?: string;
  postalCode?: string;
  phone?: string;
  website?: string;
  lat?: number;
  lng?: number;
  /** RCDSO only. */
  practitioners?: Array<{
    fullName: string;
    registrationNumber?: string;
    specialty?: string;
  }>;
  permits?: { sedation?: boolean; cbct?: boolean };
  raw: unknown;
}

export function writeJson(path: string, data: unknown): void {
  const fs = require("node:fs") as typeof import("node:fs");
  const dir = path.split("/").slice(0, -1).join("/");
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

export function readJson<T>(path: string): T | undefined {
  const fs = require("node:fs") as typeof import("node:fs");
  if (!fs.existsSync(path)) return undefined;
  return JSON.parse(fs.readFileSync(path, "utf8")) as T;
}
