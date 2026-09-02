// Password hashing with WebCrypto (PBKDF2-SHA256).
// The password gates the app UI and separates accounts. It does NOT encrypt the
// exported CSV file — that file stays readable in Excel by design.
// Requires a secure context (https or localhost).

const ITERATIONS = 150000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export function isCryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

export function generateSalt() {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  return bytesToHex(salt);
}

export async function hashPassword(password, saltHex, iterations = ITERATIONS) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    baseKey,
    KEY_BITS
  );
  return bytesToHex(new Uint8Array(bits));
}

// Compares without leaking timing information through early exit.
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyPassword(password, account) {
  const hash = await hashPassword(password, account.salt, account.iterations || ITERATIONS);
  return constantTimeEqual(hash, account.hash);
}

export const DEFAULT_ITERATIONS = ITERATIONS;
