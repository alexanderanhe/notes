export const VAULT_ENCRYPTION_VERSION = 2;
export const MIN_PBKDF2_ITERATIONS = 250_000;
export const MAX_PBKDF2_ITERATIONS = 2_000_000;
export const ENCRYPTED_MASTER_KEY_BYTES = 60;

export interface VaultEnvelope {
  encryptedMasterKey: string;
  masterKeyIv: string;
  kdfSalt: string;
  iterations: number;
  encryptionVersion: number;
}

export function isVaultEnvelope(value: unknown): value is VaultEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  return (
    isBase64Bytes(envelope.encryptedMasterKey, ENCRYPTED_MASTER_KEY_BYTES) &&
    isBase64Bytes(envelope.masterKeyIv, 12) &&
    isBase64Bytes(envelope.kdfSalt, 16) &&
    typeof envelope.iterations === "number" &&
    Number.isSafeInteger(envelope.iterations) &&
    envelope.iterations >= MIN_PBKDF2_ITERATIONS &&
    envelope.iterations <= MAX_PBKDF2_ITERATIONS &&
    envelope.encryptionVersion === VAULT_ENCRYPTION_VERSION
  );
}

function isBase64Bytes(value: unknown, bytes: number) {
  if (typeof value !== "string" || value.length % 4 !== 0) return false;
  try {
    return atob(value).length === bytes;
  } catch {
    return false;
  }
}
