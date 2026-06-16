import {
  decryptNoteKey,
  decryptString,
  deriveKeyFromPassword,
  encryptNoteKey,
  encryptString,
  generateNoteKey,
  generateRandomBytes,
} from "~/lib/crypto.client";
import { createDocumentBlock } from "~/lib/document-blocks";
import { normalizeTags } from "~/lib/folders";
import {
  VAULT_ITEM_ENCRYPTION_VERSION,
  type EncryptedVaultItem,
  type EncryptedVaultItemInput,
  type VaultItem,
  type VaultItemEvent,
  type VaultItemNotes,
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
    requiresRecent2FA?: boolean;
    folderId?: string | null;
    itemKey?: CryptoKey;
    itemNotes?: VaultItemNotes;
    extraPasswordFields?: ExtraPasswordFields | null;
  },
): Promise<EncryptedVaultItemInput> {
  const tags = options.tags ?? [];
  const contentKey = options.itemKey ?? masterKey;
  const [title, encryptedPayload, searchText, encryptedTags] = await Promise.all([
    encryptString(options.title, contentKey),
    encryptString(JSON.stringify(payload), contentKey),
    encryptString(buildSearchText(options.title, tags, payload), contentKey),
    encryptString(JSON.stringify(tags), contentKey),
  ]);
  const encryptedItemNotes = options.itemNotes
    ? await encryptString(JSON.stringify(options.itemNotes), contentKey)
    : null;
  return {
    type,
    folderId: options.folderId ?? null,
    encryptedTitle: title.ciphertext,
    titleIv: title.iv,
    encryptedPayload: encryptedPayload.ciphertext,
    payloadIv: encryptedPayload.iv,
    encryptedSearchText: searchText.ciphertext,
    searchTextIv: searchText.iv,
    ...(encryptedItemNotes ? {
      encryptedItemNotes: encryptedItemNotes.ciphertext,
      itemNotesIv: encryptedItemNotes.iv,
    } : {}),
    tagsEncrypted: encryptedTags.ciphertext,
    tagsIv: encryptedTags.iv,
    favorite: options.favorite ?? false,
    archived: options.archived ?? false,
    pinned: options.pinned ?? false,
    requiresRecent2FA: options.requiresRecent2FA ?? false,
    hasExtraPassword: Boolean(options.extraPasswordFields),
    ...(options.extraPasswordFields ?? {}),
    encryptionVersion: VAULT_ITEM_ENCRYPTION_VERSION,
  };
}

export async function decryptVaultItemPayload<T extends VaultItemType>(
  item: EncryptedVaultItem & { type: T },
  masterKey: CryptoKey,
  itemKey?: CryptoKey | null,
): Promise<VaultItem<T>> {
  if (item.hasExtraPassword && !itemKey) {
    return {
      id: item.id,
      type: item.type,
      folderId: item.folderId,
      title: "Protected item",
      payload: getDefaultPayloadForType(item.type) as VaultItemPayloadMap[T],
      tags: [],
      favorite: item.favorite,
      archived: item.archived,
      pinned: item.pinned,
      requiresRecent2FA: item.requiresRecent2FA ?? false,
      hasExtraPassword: true,
      extraPasswordSalt: item.extraPasswordSalt,
      extraPasswordEncryptedItemKey: item.extraPasswordEncryptedItemKey,
      extraPasswordItemKeyIv: item.extraPasswordItemKeyIv,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
  const contentKey = itemKey ?? masterKey;
  const [title, payload, tags] = await Promise.all([
    decryptString({ ciphertext: item.encryptedTitle, iv: item.titleIv }, contentKey),
    decryptString({ ciphertext: item.encryptedPayload, iv: item.payloadIv }, contentKey),
    decryptString({ ciphertext: item.tagsEncrypted, iv: item.tagsIv }, contentKey),
  ]);
  const itemNotes = item.encryptedItemNotes && item.itemNotesIv
    ? JSON.parse(await decryptString({ ciphertext: item.encryptedItemNotes, iv: item.itemNotesIv }, contentKey)) as VaultItemNotes
    : undefined;
  return {
    id: item.id,
    type: item.type,
    folderId: item.folderId,
    title,
    payload: JSON.parse(payload) as VaultItemPayloadMap[T],
    itemNotes,
    tags: JSON.parse(tags) as string[],
    favorite: item.favorite,
    archived: item.archived,
    pinned: item.pinned,
    requiresRecent2FA: item.requiresRecent2FA ?? false,
    hasExtraPassword: item.hasExtraPassword,
    extraPasswordSalt: item.extraPasswordSalt,
    extraPasswordEncryptedItemKey: item.extraPasswordEncryptedItemKey,
    extraPasswordItemKeyIv: item.extraPasswordItemKeyIv,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

interface ExtraPasswordFields {
  extraPasswordSalt: string;
  extraPasswordEncryptedItemKey: string;
  extraPasswordItemKeyIv: string;
}

async function wrapItemKey(itemKey: CryptoKey, password: string): Promise<ExtraPasswordFields> {
  const { key, salt } = await deriveKeyFromPassword(password);
  const encrypted = await encryptNoteKey(itemKey, key);
  return {
    extraPasswordSalt: salt,
    extraPasswordEncryptedItemKey: encrypted.ciphertext,
    extraPasswordItemKeyIv: encrypted.iv,
  };
}

export async function unlockProtectedVaultItemKey(item: EncryptedVaultItem, password: string) {
  if (
    !item.hasExtraPassword ||
    !item.extraPasswordSalt ||
    !item.extraPasswordEncryptedItemKey ||
    !item.extraPasswordItemKeyIv
  ) {
    throw new Error("The item is not protected.");
  }
  const { key } = await deriveKeyFromPassword(password, item.extraPasswordSalt);
  return decryptNoteKey({
    ciphertext: item.extraPasswordEncryptedItemKey,
    iv: item.extraPasswordItemKeyIv,
  }, key);
}

export async function protectVaultItem<T extends VaultItemType>(
  item: VaultItem<T>,
  password: string,
  masterKey: CryptoKey,
) {
  const itemKey = await generateNoteKey();
  const extraPasswordFields = await wrapItemKey(itemKey, password);
  return {
    itemKey,
    input: await encryptVaultItemPayload(item.type, item.payload, masterKey, {
      title: item.title,
      tags: item.tags,
      favorite: item.favorite,
      archived: item.archived,
      pinned: item.pinned,
      requiresRecent2FA: item.requiresRecent2FA,
      folderId: item.folderId,
      itemKey,
      extraPasswordFields,
    }),
  };
}

export async function changeVaultItemExtraPassword(item: EncryptedVaultItem, currentPassword: string, newPassword: string) {
  const itemKey = await unlockProtectedVaultItemKey(item, currentPassword);
  return { itemKey, extraPasswordFields: await wrapItemKey(itemKey, newPassword) };
}

export async function removeVaultItemExtraPassword(item: EncryptedVaultItem, password: string) {
  return unlockProtectedVaultItemKey(item, password);
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

export async function moveItemToFolder(itemId: string, folderId: string | null) {
  return requestJson<{ item: EncryptedVaultItem }>(`/api/vault-items/${itemId}/folder`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
}

export async function updateVaultItemTags(
  item: VaultItem,
  tags: string[],
  masterKey: CryptoKey,
  itemKey?: CryptoKey | null,
) {
  tags = normalizeTags(tags);
  const contentKey = item.hasExtraPassword ? itemKey : masterKey;
  if (!contentKey) throw new Error("Unlock this item before changing tags.");
  const [encryptedTags, searchText] = await Promise.all([
    encryptString(JSON.stringify(tags), contentKey),
    encryptString(buildSearchText(item.title, tags, item.payload), contentKey),
  ]);
  return requestJson<{ item: EncryptedVaultItem }>(`/api/vault-items/${item.id}/tags`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tagsEncrypted: encryptedTags.ciphertext,
      tagsIv: encryptedTags.iv,
      encryptedSearchText: searchText.ciphertext,
      searchTextIv: searchText.iv,
      tagCount: tags.length,
    }),
  });
}

export async function updateVaultItemNotes(
  item: VaultItem,
  markdown: string,
  masterKey: CryptoKey,
  itemKey?: CryptoKey | null,
) {
  const contentKey = item.hasExtraPassword ? itemKey : masterKey;
  if (!contentKey) throw new Error("Unlock this item before changing notes.");
  const itemNotes: VaultItemNotes = {
    version: 1,
    markdown,
    updatedAt: new Date().toISOString(),
  };
  const encrypted = await encryptString(JSON.stringify(itemNotes), contentKey);
  return requestJson<{ item: EncryptedVaultItem }>(`/api/vault-items/${item.id}/item-notes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      encryptedItemNotes: encrypted.ciphertext,
      itemNotesIv: encrypted.iv,
    }),
  });
}

export async function listVaultItemEvents(itemId: string) {
  return requestJson<{ events: VaultItemEvent[] }>(`/api/vault-items/${itemId}/events`, { method: "GET" });
}

export const addTagToItem = (item: VaultItem, tag: string, masterKey: CryptoKey) =>
  updateVaultItemTags(item, [...item.tags, tag], masterKey);

export const removeTagFromItem = (item: VaultItem, tag: string, masterKey: CryptoKey) =>
  updateVaultItemTags(item, item.tags.filter((value) => value !== tag), masterKey);

export async function toggleFavorite(itemId: string, favorite: boolean) {
  return requestJson<{ item: EncryptedVaultItem }>(`/api/vault-items/${itemId}/favorite`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite }),
  });
}

export async function archiveItem(itemId: string, archived: boolean) {
  return requestJson<{ item: EncryptedVaultItem }>(`/api/vault-items/${itemId}/archive`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  });
}

export async function pinItem(itemId: string, pinned: boolean) {
  return requestJson<{ item: EncryptedVaultItem }>(`/api/vault-items/${itemId}/pinned`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
}

export async function requireRecent2FAForItem(itemId: string, requiresRecent2FA: boolean) {
  return requestJson<{ item: EncryptedVaultItem }>(`/api/vault-items/${itemId}/recent-2fa`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requiresRecent2FA }),
  });
}

export async function authorizeSensitiveVaultAction() {
  return requestJson<{ authorized: true }>("/api/vault-items/copy-authorize", { method: "GET" });
}

export function getDefaultPayloadForType(type: VaultItemType): VaultItemPayloadMap[VaultItemType] {
  const defaults: Record<VaultItemType, VaultItemPayloadMap[VaultItemType]> = {
    note: { markdown: "" },
    document: { version: 2, blocks: [createDocumentBlock()] },
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
  if (!response.ok) {
    const error = new Error("The vault item operation failed.") as Error & { status?: number; data?: unknown };
    error.status = response.status;
    error.data = await response.json().catch(() => null);
    throw error;
  }
  return response.json() as Promise<T>;
}
