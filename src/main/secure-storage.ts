import fs from 'node:fs';
import path from 'node:path';
import electronModule from 'electron';

const electron = (typeof electronModule === 'object' && electronModule !== null ? electronModule : {}) as any;

export const ENCRYPTED_PREFIX = 'enc:v1:';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

let customSafeStorage: SafeStorageLike | null = null;

/** Test hook to inject a deterministic safeStorage implementation under Node tests. */
export function configureSecureStorage(storage: SafeStorageLike | null): void {
  customSafeStorage = storage;
}

function resolveSafeStorage(): SafeStorageLike | null {
  if (customSafeStorage) return customSafeStorage;
  const ss = electron?.safeStorage;
  if (ss && typeof ss.isEncryptionAvailable === 'function') {
    return ss as SafeStorageLike;
  }
  return null;
}

/**
 * Returns true when OS-backed secret encryption (Windows DPAPI / macOS Keychain /
 * Linux libsecret) is available in the current runtime.
 */
export function isSecureEncryptionAvailable(): boolean {
  try {
    const ss = resolveSafeStorage();
    return Boolean(ss && ss.isEncryptionAvailable());
  } catch {
    return false;
  }
}

/**
 * Encrypts a secret string with OS safeStorage (`enc:v1:<base64>`).
 * Falls back to returning the input unchanged only in headless/test runtimes
 * where Electron safeStorage is unavailable.
 */
export function encryptSecretString(plain: string): string {
  if (!plain) return '';
  if (plain.startsWith(ENCRYPTED_PREFIX)) return plain;
  const ss = resolveSafeStorage();
  if (ss) {
    try {
      if (ss.isEncryptionAvailable()) {
        const encrypted = ss.encryptString(plain);
        return `${ENCRYPTED_PREFIX}${Buffer.from(encrypted).toString('base64')}`;
      }
    } catch {
      // Fall through if OS keyring fails unexpectedly
    }
  }
  return plain;
}

/**
 * Decrypts a value produced by `encryptSecretString`.
 * Legacy plaintext values (without `enc:v1:`) are returned as-is for seamless migration.
 * Encrypted values return `''` if decryption fails or safeStorage is unavailable.
 */
export function decryptSecretString(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    return stored;
  }
  const ss = resolveSafeStorage();
  if (!ss) return '';
  try {
    if (!ss.isEncryptionAvailable()) return '';
    const buf = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64');
    return ss.decryptString(buf);
  } catch {
    return '';
  }
}

export function isEncryptedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/** Writes sensitive local state atomically with owner-only POSIX file permissions. */
export function writePrivateFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}
