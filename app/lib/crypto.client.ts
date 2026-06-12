const AES_KEY_LENGTH = 256;
const AES_GCM_IV_BYTES = 12;
const PBKDF2_SALT_BYTES = 16;

export const PBKDF2_ITERATIONS = 250_000;

export interface EncryptedData {
  ciphertext: string;
  iv: string;
}

export interface DerivedKey {
  key: CryptoKey;
  salt: string;
  iterations: number;
}

function getWebCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API no está disponible.");
  }

  return globalThis.crypto;
}

export function generateRandomBytes(length: number) {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new Error("La longitud debe ser un entero positivo.");
  }

  return getWebCrypto().getRandomValues(new Uint8Array(length));
}

export function arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferView) {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function base64ToArrayBuffer(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export async function deriveKeyFromPassword(
  password: string,
  salt = arrayBufferToBase64(generateRandomBytes(PBKDF2_SALT_BYTES)),
  iterations = PBKDF2_ITERATIONS,
): Promise<DerivedKey> {
  if (!password) {
    throw new Error("La contraseña es obligatoria.");
  }

  if (!Number.isSafeInteger(iterations) || iterations < PBKDF2_ITERATIONS) {
    throw new Error(`PBKDF2 requiere al menos ${PBKDF2_ITERATIONS} iteraciones.`);
  }

  const crypto = getWebCrypto();
  const passwordMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToArrayBuffer(salt),
      iterations,
    },
    passwordMaterial,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );

  return { key, salt, iterations };
}

export async function encryptString(
  value: string,
  key: CryptoKey,
): Promise<EncryptedData> {
  const iv = generateRandomBytes(AES_GCM_IV_BYTES);
  const ciphertext = await getWebCrypto().subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
  };
}

export async function decryptString(data: EncryptedData, key: CryptoKey) {
  const plaintext = await getWebCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(data.iv) },
    key,
    base64ToArrayBuffer(data.ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

export function generateNoteKey() {
  return getWebCrypto().subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

export const generateMasterKey = generateNoteKey;

export function exportCryptoKey(key: CryptoKey) {
  return getWebCrypto().subtle.exportKey("raw", key);
}

export function importCryptoKey(keyData: ArrayBuffer | string) {
  const rawKey =
    typeof keyData === "string" ? base64ToArrayBuffer(keyData) : keyData;

  return getWebCrypto().subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function encryptNoteKey(noteKey: CryptoKey, userKey: CryptoKey) {
  const exportedNoteKey = await exportCryptoKey(noteKey);
  return encryptString(arrayBufferToBase64(exportedNoteKey), userKey);
}

export async function decryptNoteKey(
  encryptedNoteKey: EncryptedData,
  userKey: CryptoKey,
) {
  const exportedNoteKey = await decryptString(encryptedNoteKey, userKey);
  return importCryptoKey(exportedNoteKey);
}

export const encryptMasterKey = encryptNoteKey;
export const decryptMasterKey = decryptNoteKey;
