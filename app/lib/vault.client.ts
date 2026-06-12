import {
  arrayBufferToBase64,
  decryptMasterKey,
  deriveKeyFromPassword,
  encryptMasterKey,
  encryptString,
  exportCryptoKey,
  generateMasterKey,
  importCryptoKey,
  decryptString,
} from "~/lib/crypto.client";
import {
  VAULT_ENCRYPTION_VERSION,
  type VaultEnvelope,
} from "~/lib/vault";
import { decryptLegacyNote, encryptNote } from "~/lib/notes.client";
import type { EncryptedNote, EncryptedNoteSummary } from "~/lib/notes";

const databaseName = "notes-device-vault";
const storeName = "device-keys";
const deviceRecordKey = "active-device-key";

interface DeviceUnlockRecord {
  id: string;
  userId: string;
  deviceKey: CryptoKey;
  encryptedMasterKey: string;
  masterKeyIv: string;
}

export interface VaultRecoveryAdapter {
  persist: (userId: string, masterKey: CryptoKey) => Promise<void>;
  recover: (userId: string) => Promise<CryptoKey | null>;
  clear: () => Promise<void>;
}

function openDeviceDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDeviceDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function createVaultEnvelope(password: string) {
  const [{ key: userKey, salt, iterations }, masterKey] = await Promise.all([
    deriveKeyFromPassword(password),
    generateMasterKey(),
  ]);
  const encryptedMasterKey = await encryptMasterKey(masterKey, userKey);
  const envelope: VaultEnvelope = {
    encryptedMasterKey: encryptedMasterKey.ciphertext,
    masterKeyIv: encryptedMasterKey.iv,
    kdfSalt: salt,
    iterations,
    encryptionVersion: VAULT_ENCRYPTION_VERSION,
  };
  return { envelope, masterKey };
}

export async function openVaultEnvelope(
  password: string,
  envelope: VaultEnvelope,
) {
  const { key: userKey } = await deriveKeyFromPassword(
    password,
    envelope.kdfSalt,
    envelope.iterations,
  );
  return decryptMasterKey(
    {
      ciphertext: envelope.encryptedMasterKey,
      iv: envelope.masterKeyIv,
    },
    userKey,
  );
}

export async function persistDeviceUnlock(userId: string, masterKey: CryptoKey) {
  const deviceKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const rawMasterKey = await exportCryptoKey(masterKey);
  const masterKeyAsBase64 = arrayBufferToBase64(rawMasterKey);
  const wrapped = await encryptString(masterKeyAsBase64, deviceKey);

  await withStore("readwrite", (store) =>
    store.put({
      id: deviceRecordKey,
      userId,
      deviceKey,
      encryptedMasterKey: wrapped.ciphertext,
      masterKeyIv: wrapped.iv,
    } satisfies DeviceUnlockRecord),
  );
}

export async function recoverDeviceUnlock(userId: string) {
  const record = await withStore<DeviceUnlockRecord | undefined>(
    "readonly",
    (store) => store.get(deviceRecordKey),
  );
  if (!record || record.userId !== userId) return null;

  const rawMasterKey = await decryptString(
    {
      ciphertext: record.encryptedMasterKey,
      iv: record.masterKeyIv,
    },
    record.deviceKey,
  );
  return importCryptoKey(rawMasterKey);
}

export async function clearDeviceUnlock() {
  if (!globalThis.indexedDB) return;
  await withStore("readwrite", (store) => store.delete(deviceRecordKey));
}

export const deviceRecoveryAdapter: VaultRecoveryAdapter = {
  persist: persistDeviceUnlock,
  recover: recoverDeviceUnlock,
  clear: clearDeviceUnlock,
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function migrateLegacyNotes(
  password: string,
  masterKey: CryptoKey,
) {
  const { notes } = await requestJson<{ notes: EncryptedNoteSummary[] }>(
    "/api/notes",
  );
  const legacyNotes = notes.filter((note) => note.encryptionVersion === 1);

  for (const summary of legacyNotes) {
    const { note } = await requestJson<{ note: EncryptedNote }>(
      `/api/notes/${summary.id}`,
    );
    const plain = await decryptLegacyNote(note, password);
    const encrypted = await encryptNote(plain, masterKey, {
      pinned: note.pinned,
      archived: note.archived,
    });
    await requestJson(`/api/notes/${summary.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(encrypted),
    });
  }

  return legacyNotes.length;
}
