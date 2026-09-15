import crypto from 'node:crypto';
import { env } from '../../config/env';

/**
 * Symmetric encryption for secrets stored at rest (e.g. the SMTP password).
 * AES-256-GCM (authenticated). The 32-byte key is derived from a server secret
 * via scrypt — prefer a dedicated SETTINGS_SECRET; fall back to JWT_SECRET so
 * existing deployments work without new configuration.
 *
 * Format: "<ivB64>:<tagB64>:<cipherB64>". decrypt() throws on tampering.
 */
const ALGORITHM = 'aes-256-gcm';

function deriveKey(): Buffer {
  const secret = env.SETTINGS_SECRET || env.JWT_SECRET;
  return crypto.scryptSync(secret, 'truegear-settings-salt', 32);
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = (payload ?? '').split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted value');
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
