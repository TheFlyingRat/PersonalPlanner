import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;

function getKey(salt: Buffer): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  // Note: changing scrypt params invalidates previously encrypted data.
  // Existing OAuth tokens will need to be re-obtained via the OAuth flow.
  return scryptSync(secret, salt, 32, { N: 65536, r: 8, p: 1 });
}

export function encrypt(text: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(16);
  const key = getKey(salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${salt.toString('hex')}:${iv.toString('hex')}:${tag}:${encrypted}`;
}

export function decrypt(data: string): string {
  const parts = data.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format');
  }
  const [saltHex, ivHex, tagHex, encrypted] = parts;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const key = getKey(salt);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    throw new Error('Failed to decrypt data');
  }
}
