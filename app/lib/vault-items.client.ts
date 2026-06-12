import { decryptString, encryptString, generateRandomBytes } from "~/lib/crypto.client";
import {
  VAULT_ITEM_ENCRYPTION_VERSION,
  type EncryptedVaultItem,
  type EncryptedVaultItemInput,
  type VaultItem,
  type VaultItemPayloadMap,
  type VaultItemType,
} from "~/lib/vault-items";

export async function encryptVaultItemPayload<T extends VaultItemType>(
  type: T,
  payload: VaultItemPayloadMap[T],
  masterKey: CryptoKey,
  options: {
    title: string;
    tags?: string[];
    favorite?: boolean;
    archived?: boolean;
    pinned?: boolean;
  },
): Promise<EncryptedVaultItemInput> {
  const tags = options.tags ?? [];
  const [title, encryptedPayload, searchText, encryptedTags] = await Promise.all([
    encryptString(options.title, masterKey),
    encryptString(JSON.stringify(payload), masterKey),
    encryptString(buildSearchText(options.title, tags, payload), masterKey),
    encryptString(JSON.stringify(tags), masterKey),
  ]);
  return {
    type,
    encryptedTitle: title.ciphertext,
    titleIv: title.iv,
    encryptedPayload: encryptedPayload.ciphertext,
    payloadIv: encryptedPayload.iv,
    encryptedSearchText: searchText.ciphertext,
    searchTextIv: searchText.iv,
    tagsEncrypted: encryptedTags.ciphertext,
    tagsIv: encryptedTags.iv,
    favorite: options.favorite ?? false,
    archived: options.archived ?? false,
    pinned: options.pinned ?? false,
    encryptionVersion: VAULT_ITEM_ENCRYPTION_VERSION,
  };
}

export async function decryptVaultItemPayload<T extends VaultItemType>(
  item: EncryptedVaultItem & { type: T },
  masterKey: CryptoKey,
): Promise<VaultItem<T>> {
  const [title, payload, tags] = await Promise.all([
    decryptString({ ciphertext: item.encryptedTitle, iv: item.titleIv }, masterKey),
    decryptString({ ciphertext: item.encryptedPayload, iv: item.payloadIv }, masterKey),
    decryptString({ ciphertext: item.tagsEncrypted, iv: item.tagsIv }, masterKey),
  ]);
  return {
    id: item.id,
    type: item.type,
    title,
    payload: JSON.parse(payload) as VaultItemPayloadMap[T],
    tags: JSON.parse(tags) as string[],
    favorite: item.favorite,
    archived: item.archived,
    pinned: item.pinned,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function createVaultItem<T extends VaultItemType>(
  type: T,
  payload: VaultItemPayloadMap[T],
  masterKey: CryptoKey,
  options: Parameters<typeof encryptVaultItemPayload<T>>[3],
) {
  const input = await encryptVaultItemPayload(type, payload, masterKey, options);
  return requestJson<{ item: EncryptedVaultItem }>("/api/vault-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateVaultItem<T extends VaultItemType>(
  id: string,
  type: T,
  payload: VaultItemPayloadMap[T],
  masterKey: CryptoKey,
  options: Parameters<typeof encryptVaultItemPayload<T>>[3],
) {
  const input = await encryptVaultItemPayload(type, payload, masterKey, options);
  return requestJson<{ item: EncryptedVaultItem }>(`/api/vault-items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getDefaultPayloadForType(type: VaultItemType): VaultItemPayloadMap[VaultItemType] {
  const defaults: Record<VaultItemType, VaultItemPayloadMap[VaultItemType]> = {
    note: { markdown: "" },
    password: { username: "", password: "", url: "", notes: "" },
    secure_note: { text: "" },
    secret: { name: "", value: "", environment: "development", notes: "" },
    server: { host: "", ip: "", username: "", port: 22, sshKeyRef: "", notes: "" },
    database: { engine: "postgres", connectionString: "", host: "", port: 5432, username: "", database: "", notes: "" },
    software_license: { product: "", licenseKey: "", accountEmail: "", url: "", notes: "" },
    wifi: { ssid: "", password: "", security: "WPA2", location: "", notes: "" },
    credit_card: { cardholder: "", number: "", expiryMonth: "", expiryYear: "", cvv: "", bank: "", notes: "" },
    identity: { fullName: "", documentType: "passport", documentNumber: "", country: "", expiresAt: "", notes: "" },
    recovery_codes: { service: "", codes: [], notes: "" },
    bookmark: { url: "", description: "", notes: "" },
    code_snippet: { language: "", code: "", description: "", notes: "" },
    checklist: { items: [] },
    template: { templateType: "", markdown: "" },
  };
  return structuredClone(defaults[type]);
}

export function getVaultItemDisplayFields(type: VaultItemType, payload: VaultItemPayloadMap[VaultItemType]) {
  return Object.entries(payload)
    .filter(([, value]) => typeof value === "string" && value)
    .slice(0, type === "password" ? 2 : 3)
    .map(([label, value]) => ({ label, value: String(value) }));
}

export function generateSecurePassword(options: {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  avoidRepeats: boolean;
}) {
  const ambiguous = new Set("Il1O0o");
  const groups = [
    options.lowercase ? "abcdefghijklmnopqrstuvwxyz" : "",
    options.uppercase ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "",
    options.numbers ? "0123456789" : "",
    options.symbols ? "!@#$%^&*()-_=+[]{};:,.?" : "",
  ].map((group) => options.excludeAmbiguous
    ? [...group].filter((character) => !ambiguous.has(character)).join("")
    : group).filter(Boolean);
  const pool = groups.join("");
  if (
    !pool ||
    options.length < groups.length ||
    options.length > 256 ||
    (options.avoidRepeats && options.length > new Set(pool).size)
  ) {
    throw new Error("Invalid password generator options.");
  }
  const result = groups.map((group) => pick(group));
  while (result.length < options.length) {
    const candidates = options.avoidRepeats
      ? [...pool].filter((character) => !result.includes(character)).join("")
      : pool;
    result.push(pick(candidates));
  }
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1);
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result.join("");
}

export async function copySensitiveValue(value: string) {
  await navigator.clipboard.writeText(value);
  window.setTimeout(() => {
    void navigator.clipboard.readText()
      .then((current) => {
        if (current === value) return navigator.clipboard.writeText("");
      })
      .catch(() => undefined);
  }, 30_000);
}

function buildSearchText(title: string, tags: string[], payload: unknown) {
  return `${title}\n${tags.join(" ")}\n${JSON.stringify(payload)}`.toLocaleLowerCase();
}

function randomIndex(length: number) {
  const ceiling = Math.floor(0x1_0000_0000 / length) * length;
  let value = 0;
  do {
    value = new Uint32Array(generateRandomBytes(4).buffer)[0]!;
  } while (value >= ceiling);
  return value % length;
}

function pick(value: string) {
  return value[randomIndex(value.length)]!;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error("The vault item operation failed.");
  return response.json() as Promise<T>;
}
