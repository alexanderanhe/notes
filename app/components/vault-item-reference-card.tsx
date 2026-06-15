import { FiBookmark, FiCode, FiCopy, FiDatabase, FiFileText, FiKey, FiLock, FiServer, FiX } from "react-icons/fi";
import { toast } from "sonner";

import { blocksToMarkdown, documentPayloadToBlocks, type DocumentPayload, type DocumentReferenceBlockType } from "~/lib/document-blocks";
import { copySensitiveValue } from "~/lib/vault-items.client";
import { isDocumentVaultItemType, VAULT_ITEM_LABELS, type VaultItem, type VaultItemType } from "~/lib/vault-items";

export const REFERENCE_TYPE_TO_ITEM_TYPE: Record<DocumentReferenceBlockType, VaultItemType> = {
  password_reference: "password",
  secret_reference: "secret",
  server_reference: "server",
  database_reference: "database",
  bookmark_reference: "bookmark",
  document_reference: "document",
  code_snippet_reference: "code_snippet",
};

export function referenceTypeAcceptsItem(type: DocumentReferenceBlockType, item: VaultItem) {
  const expected = REFERENCE_TYPE_TO_ITEM_TYPE[type];
  return expected === "document" ? isDocumentVaultItemType(item.type) : item.type === expected;
}

export function VaultItemReferenceCard({ type, itemId, items, locked = false, onOpen, onRemove }: {
  type: DocumentReferenceBlockType;
  itemId: string;
  items: VaultItem[];
  locked?: boolean;
  onOpen?: (item: VaultItem) => void;
  onRemove?: () => void;
}) {
  const item = items.find((candidate) => candidate.id === itemId && referenceTypeAcceptsItem(type, candidate));
  if (locked) return <ReferenceState icon={<FiLock />} title="Locked reference" detail="Unlock the original item to view it." />;
  if (!item) return <ReferenceState icon={<FiX />} title="Missing reference" detail="The original item no longer exists." />;

  const payload = item.payload as Record<string, unknown>;
  const copy = (field: string, label: string) => {
    const value = String(payload[field] ?? "");
    if (!value) return;
    toast.warning(`Copy ${label}?`, {
      id: `copy-reference-${item.id}-${field}`,
      description: "This copies the current decrypted value and clears the clipboard after 30 seconds.",
      action: {
        label: "Copy",
        onClick: () => void authorizeSensitiveCopy().then((authorized) => {
          if (authorized) return copySensitiveValue(value).then(() => toast.success(`${label} copied`));
        }),
      },
      cancel: { label: "Cancel", onClick: () => undefined },
    });
  };

  return <article className="vault-reference-card">
    <button type="button" className="vault-reference-main" onClick={() => onOpen?.(item)}>
      <span className={`vault-reference-icon type-${item.type}`}>{referenceIcon(item.type)}</span>
      <span className="vault-reference-copy">
        <span><strong>{item.title || "Untitled"}</strong><em>{VAULT_ITEM_LABELS[item.type]}</em></span>
        <small>{referenceSummary(item)}</small>
        {item.tags.length ? <span className="vault-reference-tags">{item.tags.slice(0, 3).map((tag) => <i key={tag}># {tag}</i>)}</span> : null}
      </span>
    </button>
    <span className="vault-reference-actions">
      {item.type === "password" ? <button type="button" onClick={() => copy("password", "password")} title="Copy password"><FiCopy /></button> : null}
      {item.type === "secret" ? <button type="button" onClick={() => copy("value", "secret value")} title="Copy secret value"><FiCopy /></button> : null}
      {onRemove ? <button type="button" onClick={onRemove} title="Remove reference"><FiX /></button> : null}
    </span>
  </article>;
}

async function authorizeSensitiveCopy() {
  const response = await fetch("/api/vault-items/copy-authorize");
  const result = await response.json() as { authorized?: boolean; confirmUrl?: string };
  if (response.status === 428) {
    window.location.assign(result.confirmUrl ?? "/auth/2fa/confirm");
    return false;
  }
  if (!response.ok || !result.authorized) {
    toast.error("The sensitive value could not be copied.");
    return false;
  }
  return true;
}

function ReferenceState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <article className="vault-reference-card is-missing"><span className="vault-reference-icon">{icon}</span><span className="vault-reference-copy"><strong>{title}</strong><small>{detail}</small></span></article>;
}

function referenceIcon(type: VaultItemType) {
  if (type === "password" || type === "secret") return <FiKey />;
  if (type === "server") return <FiServer />;
  if (type === "database") return <FiDatabase />;
  if (type === "bookmark") return <FiBookmark />;
  if (type === "code_snippet") return <FiCode />;
  return <FiFileText />;
}

function referenceSummary(item: VaultItem) {
  const payload = item.payload as Record<string, unknown>;
  if (item.type === "bookmark") return String(payload.url || "No URL");
  if (item.type === "password") return String(payload.username || "No username");
  if (item.type === "secret") return String(payload.environment || "No environment");
  if (item.type === "server") return [payload.host || payload.ip, payload.username, payload.port].filter(Boolean).join(" · ") || "No connection details";
  if (item.type === "database") return [payload.engine, payload.host || payload.database].filter(Boolean).join(" · ") || "No connection details";
  if (item.type === "code_snippet") return [payload.language, String(payload.description || "").slice(0, 90)].filter(Boolean).join(" · ") || "Code snippet";
  if (isDocumentVaultItemType(item.type)) {
    return blocksToMarkdown(documentPayloadToBlocks(item.payload as DocumentPayload)).replace(/\s+/g, " ").slice(0, 110) || "Empty document";
  }
  return VAULT_ITEM_LABELS[item.type];
}
