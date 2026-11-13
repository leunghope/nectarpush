import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * AES-256-GCM helpers for channel secrets / tokens at rest, plus the
 * HMAC-signed session cookie and scrypt password hashing. All key material
 * derives from ENCRYPTION_KEY or SESSION_SECRET.
 */
let cachedKey: Buffer | null = null;
let cachedSecret = '';

function masterKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'dev-secret';
  if (!cachedKey || cachedSecret !== secret) {
    cachedKey = scryptSync(secret, 'nectarpush-encryption-salt', 32);
    cachedSecret = secret;
  }
  return cachedKey;
}

/** Encrypt UTF-8 text -> base64 "iv.tag.ciphertext". */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

/** Decrypt a value produced by encrypt(); returns null when undecodable. */
export function decrypt(payload: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      masterKey(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** scrypt password hash -> "salt.hash" (both hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}.${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split('.');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

/** Signed session value: "userId.expiresAtMs.signature". */
export function signSession(userId: number, ttlMs: number): string {
  const exp = Date.now() + ttlMs;
  const core = `${userId}.${exp}`;
  return `${core}.${sessionSig(core)}`;
}

export function verifySession(
  value: string | undefined,
): { userId: number; exp: number } | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  const core = `${uid}.${exp}`;
  const expected = sessionSig(core);
  if (
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  if (Number(exp) < Date.now()) return null;
  const userId = Number(uid);
  return Number.isInteger(userId) ? { userId, exp: Number(exp) } : null;
}

/** Random human-friendly password (letters+digits, no lookalikes). */
export function randomPassword(length = 12): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function sessionSig(core: string): string {
  return createHmac(
    'sha256',
    process.env.SESSION_SECRET || 'dev-secret',
  )
    .update(core)
    .digest('base64url');
}

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}
