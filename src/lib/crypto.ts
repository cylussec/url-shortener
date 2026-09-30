const encoder = new TextEncoder();

// Upper bound enforced by workerd. The actual value must fit the Free-plan 10 ms
// CPU budget; set from the deployed benchmark (see README).
export const PBKDF2_MAX_SUPPORTED_ITERATIONS = 100_000;
export const PBKDF2_ITERATIONS = 20_000;
// Total PBKDF2 iterations one request can afford (verify + rehash).
export const PBKDF2_CPU_BUDGET_ITERATIONS = 25_000;

const SALT_BYTES = 16;
const HASH_BYTES = 32;
const TOKEN_BYTES = 32;
const DUMMY_SALT = new Uint8Array(SALT_BYTES);

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256hex(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(input)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

type ParsedHash = { iterations: number; salt: Uint8Array; hash: Uint8Array };

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return null;
  return { iterations, salt: base64ToBytes(parts[2]), hash: base64ToBytes(parts[3]) };
}

export async function hashPassword(
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const derived = await pbkdf2(password, parsed.salt, parsed.iterations);
  return timingSafeEqual(derived, parsed.hash);
}

/** Burns the same CPU as a real verify so unknown usernames are not distinguishable by timing. */
export async function dummyVerify(password: string): Promise<false> {
  await pbkdf2(password, DUMMY_SALT, PBKDF2_ITERATIONS);
  return false;
}

export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  return (
    parsed.iterations < PBKDF2_ITERATIONS &&
    parsed.iterations + PBKDF2_ITERATIONS <= PBKDF2_CPU_BUDGET_ITERATIONS
  );
}

export function generateToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}
