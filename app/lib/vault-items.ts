import type { DocumentPayload } from "~/lib/document-blocks";

export const VAULT_ITEM_ENCRYPTION_VERSION = 1;

export const VAULT_ITEM_TYPES = [
  "note",
  "document",
  "password",
  "secure_note",
  "secret",
  "server",
  "database",
  "software_license",
  "wifi",
  "credit_card",
  "identity",
  "recovery_codes",
  "bookmark",
  "code_snippet",
  "checklist",
  "template",
] as const;

export type VaultItemType = (typeof VAULT_ITEM_TYPES)[number];

export interface VaultItemPayloadMap {
  note: { markdown: string };
  document: DocumentPayload;
  password: { username: string; password: string; url: string; notes: string; totpSecret?: string };
  secure_note: { text: string };
  secret: { name: string; value: string; environment?: "development" | "staging" | "production" | "local"; notes?: string };
  server: { host: string; ip?: string; username?: string; port?: number; sshKeyRef?: string; notes?: string };
  database: { engine: "mongodb" | "postgres" | "mysql" | "redis" | "sqlite" | "other"; connectionString: string; host?: string; port?: number; username?: string; database?: string; notes?: string };
  software_license: { product: string; licenseKey: string; accountEmail?: string; url?: string; notes?: string };
  wifi: { ssid: string; password: string; security?: "WPA" | "WPA2" | "WPA3" | "WEP" | "none"; location?: string; notes?: string };
  credit_card: { cardholder: string; number: string; expiryMonth: string; expiryYear: string; cvv: string; bank?: string; notes?: string };
  identity: { fullName: string; documentType: "passport" | "license" | "national_id" | "tax_id" | "other"; documentNumber: string; country?: string; expiresAt?: string; notes?: string };
  recovery_codes: { service: string; codes: string[]; notes?: string };
  bookmark: { url: string; description?: string; notes?: string };
  code_snippet: { language: string; code: string; description?: string; notes?: string };
  checklist: { items: { id: string; text: string; checked: boolean }[] };
  template: { templateType: string; markdown: string };
}

export interface VaultItem<T extends VaultItemType = VaultItemType> {
  id: string;
  type: T;
  folderId: string | null;
  title: string;
  payload: VaultItemPayloadMap[T];
  itemNotes?: VaultItemNotes;
  tags: string[];
  favorite: boolean;
  archived: boolean;
  pinned: boolean;
  requiresRecent2FA: boolean;
  hasExtraPassword: boolean;
  extraPasswordSalt?: string;
  extraPasswordEncryptedItemKey?: string;
  extraPasswordItemKeyIv?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultItemNotes {
  version: 1;
  markdown: string;
  updatedAt: string;
}

export interface EncryptedVaultItemInput {
  type: VaultItemType;
  folderId: string | null;
  encryptedTitle: string;
  titleIv: string;
  encryptedPayload: string;
  payloadIv: string;
  encryptedSearchText: string;
  searchTextIv: string;
  encryptedItemNotes?: string;
  itemNotesIv?: string;
  tagsEncrypted: string;
  tagsIv: string;
  favorite: boolean;
  archived: boolean;
  pinned: boolean;
  requiresRecent2FA: boolean;
  hasExtraPassword: boolean;
  extraPasswordSalt?: string;
  extraPasswordEncryptedItemKey?: string;
  extraPasswordItemKeyIv?: string;
  encryptionVersion: number;
}

export type VaultItemEventType =
  | "item.created"
  | "item.updated"
  | "item.deleted"
  | "item.restored"
  | "item.folder_changed"
  | "item.tags_changed"
  | "item.favorite_changed"
  | "item.pinned_changed"
  | "item.archived_changed"
  | "item.item_notes_updated"
  | "item.extra_password_enabled"
  | "item.extra_password_disabled"
  | "item.recent_2fa_required_changed";

export interface VaultItemEvent {
  id: string;
  eventType: VaultItemEventType;
  metadata: {
    fromFolderId?: string | null;
    toFolderId?: string | null;
    tagCount?: number;
    favorite?: boolean;
    pinned?: boolean;
    archived?: boolean;
    requiresRecent2FA?: boolean;
    changedFields?: string[];
  };
  createdAt: string;
}

export interface EncryptedVaultItem extends EncryptedVaultItemInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export const VAULT_ITEM_LABELS: Record<VaultItemType, string> = {
  note: "Document",
  document: "Document",
  password: "Password",
  secure_note: "Secure note",
  secret: "Secret",
  server: "Server",
  database: "Database",
  software_license: "Software license",
  wifi: "WiFi",
  credit_card: "Credit card",
  identity: "Identity",
  recovery_codes: "Recovery codes",
  bookmark: "Bookmark",
  code_snippet: "Code snippet",
  checklist: "Checklist",
  template: "Template",
};

export function isDocumentVaultItemType(type: VaultItemType) {
  return type === "note" || type === "document";
}

export function vaultItemTypesMatch(left: VaultItemType, right: VaultItemType) {
  return left === right || (isDocumentVaultItemType(left) && isDocumentVaultItemType(right));
}
