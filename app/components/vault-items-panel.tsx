import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  FiAlertTriangle, FiArchive, FiArrowLeft, FiBookmark, FiCheckSquare, FiChevronDown, FiChevronLeft, FiChevronRight, FiClock, FiCode,
  FiCopy, FiCpu, FiCreditCard, FiDatabase, FiEdit3, FiEye, FiEyeOff, FiFileText, FiFilter, FiFolder, FiGlobe, FiGrid, FiHash, FiKey, FiList,
  FiLock, FiMoreVertical, FiPlus, FiRefreshCw, FiSave, FiSearch,
  FiServer, FiSettings, FiShield, FiStar, FiTrash2, FiUnlock, FiUser, FiWifi, FiX,
} from "react-icons/fi";
import MDEditor from "@uiw/react-md-editor/nohighlight";
import { toast } from "sonner";

import { useVault } from "~/contexts/vault-context";
import { useWorkspace } from "~/contexts/workspace-context";
import { useFolders } from "~/contexts/folder-context";
import {
  copySensitiveValue,
  createVaultItem,
  decryptVaultItemPayload,
  generateSecurePassword,
  getDefaultPayloadForType,
  moveItemToFolder,
  updateVaultItem,
  updateVaultItemTags,
} from "~/lib/vault-items.client";
import {
  changeNoteExtraPassword,
  decryptNote,
  decryptNoteTitle,
  encryptNote,
  protectNote,
  removeNoteExtraPassword,
  unlockProtectedNoteKey,
} from "~/lib/notes.client";
import type { EncryptedNote, EncryptedNoteSummary } from "~/lib/notes";
import { extractTasks, getLocalAICapabilities, suggestTitle, summarizeText, type LocalAICapabilities } from "~/lib/local-ai.client";
import {
  VAULT_ITEM_LABELS,
  VAULT_ITEM_TYPES,
  type EncryptedVaultItem,
  type VaultItem,
  type VaultItemType,
} from "~/lib/vault-items";
import { normalizeTags, type Folder, type FolderDeleteStrategy } from "~/lib/folders";

const MonacoEditor = lazy(() => import("~/components/monaco-editor.client"));

const SENSITIVE_FIELDS = new Set([
  "password", "totpSecret", "value", "connectionString", "licenseKey",
  "number", "cvv", "documentNumber", "codes", "sshKeyRef",
]);

const FIELD_LABELS: Record<string, string> = {
  markdown: "Markdown", username: "Username", password: "Password", url: "URL",
  notes: "Notes", totpSecret: "TOTP secret", text: "Text", name: "Name",
  value: "Value", environment: "Environment", host: "Host", ip: "IP address",
  port: "Port", sshKeyRef: "SSH key reference", engine: "Engine",
  connectionString: "Connection string", database: "Database", product: "Product",
  licenseKey: "License key", accountEmail: "Account email", ssid: "SSID",
  security: "Security", location: "Location", cardholder: "Cardholder",
  number: "Card number", expiryMonth: "Expiry month", expiryYear: "Expiry year",
  cvv: "CVV", bank: "Bank", fullName: "Full name", documentType: "Document type",
  documentNumber: "Document number", country: "Country", expiresAt: "Expires at",
  service: "Service", codes: "Recovery codes (one per line)", description: "Description",
  language: "Language", code: "Code", items: "Checklist items (one per line)",
  templateType: "Template type",
};

type VaultView = "all" | "favorites" | "recent" | "archive" | "uncategorized";
type SortMode = "updated-desc" | "updated-asc" | "created-desc" | "title-asc";
const PRIMARY_TYPES: VaultItemType[] = [
  "note",
  "password",
  "secret",
  "server",
  "database",
  "credit_card",
  "identity",
  "code_snippet",
];
const PRIMARY_TAG_LIMIT = 5;
const VAULT_ITEM_DESCRIPTIONS: Record<VaultItemType, string> = {
  note: "Información y contenido personal",
  password: "Guarda un inicio de sesión",
  secure_note: "Información privada protegida",
  secret: "Valor confidencial cifrado",
  server: "Información de servidor",
  database: "Conexión y acceso a base de datos",
  software_license: "Licencia y clave de software",
  wifi: "Credenciales de red WiFi",
  credit_card: "Información de tarjeta",
  identity: "Documento e información de identidad",
  recovery_codes: "Códigos de recuperación",
  bookmark: "Enlace guardado",
  code_snippet: "Fragmento de código",
  checklist: "Lista de tareas",
  template: "Plantilla reutilizable",
};
type UnifiedItem = VaultItem & {
  source: "vault" | "note";
  noteSummary?: EncryptedNoteSummary;
};

interface LegacyNoteDraft {
  encrypted: EncryptedNote;
  contentKey: CryptoKey | null;
  title: string;
  content: string;
  pinned: boolean;
  archived: boolean;
}
type NoteProtectionAction = "protect" | "change" | "remove";

export function VaultItemsPanel({ email = "" }: { email?: string; onClose?: () => void }) {
  const { masterKey } = useVault();
  const workspace = useWorkspace();
  const folderState = useFolders();
  const [encryptedItems, setEncryptedItems] = useState<EncryptedVaultItem[]>([]);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [notes, setNotes] = useState<EncryptedNoteSummary[]>([]);
  const [noteTitles, setNoteTitles] = useState<Record<string, string>>({});
  const [legacyDraft, setLegacyDraft] = useState<LegacyNoteDraft | null>(null);
  const [protectedNote, setProtectedNote] = useState<EncryptedNote | null>(null);
  const [protectionAction, setProtectionAction] = useState<NoteProtectionAction | null>(null);
  const [localAIOpen, setLocalAIOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<VaultItem | null>(null);
  const [filter, setFilter] = useState<VaultItemType | "all">(workspace.activeTypeFilter as VaultItemType | "all" || "all");
  const [view, setView] = useState<VaultView>("all");
  const [activeFolderId, setActiveFolderId] = useState<string | null>(workspace.activeFolderId);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ mode: "create" | "rename"; folder?: Folder; parentFolderId?: string | null } | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<Folder | null>(null);
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("updated-desc");
  const [displayMode, setDisplayMode] = useState<"list" | "grid">("list");
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [moreTypesOpen, setMoreTypesOpen] = useState(false);
  const [moreTagsOpen, setMoreTagsOpen] = useState(false);

  useEffect(() => {
    void Promise.all([loadItems(), loadNotes()]);
  }, []);

  useEffect(() => {
    if (!masterKey) return;
    Promise.all(encryptedItems.map((item) => decryptVaultItemPayload(item, masterKey)))
      .then(setItems)
      .catch(() => toast.error("Vault items could not be decrypted."));
  }, [encryptedItems, masterKey]);

  useEffect(() => {
    if (!masterKey) return;
    Promise.all(notes.map(async (note) => [
      note.id,
      note.isCritical
        ? "Critical note"
        : note.hasExtraPassword
          ? "Protected note"
          : await decryptNoteTitle(note, masterKey),
    ] as const))
      .then((entries) => setNoteTitles(Object.fromEntries(entries)))
      .catch(() => toast.error("Note titles could not be decrypted."));
  }, [masterKey, notes]);

  async function loadItems() {
    const response = await fetch("/api/vault-items");
    if (!response.ok) return toast.error("Vault items could not be loaded.");
    const result = await response.json() as { items: EncryptedVaultItem[] };
    setEncryptedItems(result.items);
  }

  async function loadNotes() {
    const response = await fetch("/api/notes");
    if (!response.ok) return toast.error("Notes could not be loaded.");
    const result = await response.json() as { notes: EncryptedNoteSummary[] };
    setNotes(result.notes);
  }

  function startCreate(type: VaultItemType) {
    setNewItemOpen(false);
    setSelectedId(null);
    setLegacyDraft(null);
    setDraft({
      id: "",
      type,
      folderId: activeFolderId,
      title: "",
      payload: getDefaultPayloadForType(type),
      tags: [],
      favorite: false,
      archived: false,
      pinned: false,
      createdAt: "",
      updatedAt: "",
    });
    setEditing(true);
    setDetailOpen(true);
  }

  function selectItem(item: VaultItem) {
    setSelectedId(item.id);
    setLegacyDraft(null);
    setDraft(structuredClone(item));
    workspace.openItem(item.id);
    setEditing(false);
    setDetailOpen(true);
  }

  async function selectLegacyNote(item: UnifiedItem) {
    if (!masterKey || !item.noteSummary) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/notes/${item.id}`);
      const result = await response.json() as { note?: EncryptedNote; confirmUrl?: string };
      if (response.status === 428) {
        window.location.assign(result.confirmUrl ?? "/auth/2fa/confirm");
        return;
      }
      if (!response.ok || !result.note) throw new Error();
      if (result.note.hasExtraPassword) {
        setProtectedNote(result.note);
        return;
      }
      await openLegacyNote(result.note);
    } catch {
      toast.error("The note could not be opened.");
    } finally {
      setWorking(false);
    }
  }

  async function openLegacyNote(note: EncryptedNote, noteKey?: CryptoKey) {
    if (!masterKey) return;
    const plain = await decryptNote(note, masterKey, noteKey);
    setSelectedId(note.id);
    setDraft(null);
    setLegacyDraft({
      encrypted: note,
      contentKey: noteKey ?? null,
      ...plain,
      pinned: note.pinned,
      archived: note.archived,
    });
    workspace.openNote(note.id);
    setEditing(false);
    setDetailOpen(true);
  }

  async function unlockLegacyNote(password: string) {
    if (!protectedNote) return;
    setWorking(true);
    try {
      const noteKey = await unlockProtectedNoteKey(protectedNote, password);
      await openLegacyNote(protectedNote, noteKey);
      setProtectedNote(null);
    } catch {
      toast.error("The password is incorrect.");
    } finally {
      setWorking(false);
    }
  }

  async function saveLegacyNote(nextDraft = legacyDraft) {
    if (!nextDraft || !masterKey) return;
    setWorking(true);
    try {
      const input = await encryptNote(
        { title: nextDraft.title, content: nextDraft.content },
        nextDraft.contentKey ?? masterKey,
        { pinned: nextDraft.pinned, archived: nextDraft.archived },
        nextDraft.encrypted.hasExtraPassword
          ? {
              extraPasswordSalt: nextDraft.encrypted.extraPasswordSalt!,
              extraPasswordEncryptedNoteKey: nextDraft.encrypted.extraPasswordEncryptedNoteKey!,
              extraPasswordNoteKeyIv: nextDraft.encrypted.extraPasswordNoteKeyIv!,
            }
          : undefined,
      );
      const response = await fetch(`/api/notes/${nextDraft.encrypted.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as { note: EncryptedNote };
      setLegacyDraft({ ...nextDraft, encrypted: result.note });
      setNotes((current) => current.map((note) => note.id === result.note.id ? result.note : note));
      setNoteTitles((current) => ({ ...current, [result.note.id]: nextDraft.title || "Untitled" }));
      setEditing(false);
      toast.success("Note saved");
    } catch {
      toast.error("The note could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  async function updateLegacyMetadata(changes: Partial<Pick<LegacyNoteDraft, "pinned" | "archived">>) {
    if (!legacyDraft) return;
    const next = { ...legacyDraft, ...changes };
    setLegacyDraft(next);
    await saveLegacyNote(next);
  }

  async function moveLegacyNote(folderId: string | null) {
    if (!legacyDraft) return;
    const response = await fetch(`/api/notes/${legacyDraft.encrypted.id}/folder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    if (!response.ok) return toast.error("The note could not be moved.");
    const { note } = await response.json() as { note: EncryptedNoteSummary };
    setLegacyDraft({ ...legacyDraft, encrypted: { ...legacyDraft.encrypted, ...note } });
    setNotes((current) => current.map((item) => item.id === note.id ? note : item));
    toast.success("Note moved");
  }

  async function setLegacyCritical(isCritical: boolean) {
    if (!legacyDraft) return;
    const response = await fetch(`/api/notes/${legacyDraft.encrypted.id}/critical`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isCritical }),
    });
    const result = await response.json() as { note?: EncryptedNoteSummary; confirmUrl?: string };
    if (response.status === 428) return window.location.assign(result.confirmUrl ?? "/auth/2fa/confirm");
    if (!response.ok || !result.note) return toast.error("Critical mode could not be updated.");
    setLegacyDraft({ ...legacyDraft, encrypted: { ...legacyDraft.encrypted, ...result.note } });
    setNotes((current) => current.map((item) => item.id === result.note!.id ? result.note! : item));
    toast.success(isCritical ? "Note marked as critical" : "Critical mode removed");
  }

  function confirmDeleteLegacyNote() {
    toast.warning("Permanently delete this note?", {
      duration: Infinity,
      description: "This action cannot be undone.",
      action: { label: "Delete", onClick: () => void deleteLegacyNote() },
      cancel: { label: "Cancel", onClick: () => undefined },
    });
  }

  async function deleteLegacyNote() {
    if (!legacyDraft) return;
    const id = legacyDraft.encrypted.id;
    const response = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (!response.ok) return toast.error("The note could not be deleted.");
    setNotes((current) => current.filter((note) => note.id !== id));
    setLegacyDraft(null);
    setSelectedId(null);
    setDetailOpen(false);
    workspace.closeNote(id);
    toast.success("Note deleted");
  }

  async function handleProtectionAction(currentPassword: string, newPassword: string) {
    if (!legacyDraft || !masterKey || !protectionAction) return;
    setWorking(true);
    try {
      const result = protectionAction === "protect"
        ? await protectNote({ title: legacyDraft.title, content: legacyDraft.content }, newPassword, legacyDraft)
        : protectionAction === "change"
          ? await changeNoteExtraPassword(legacyDraft.encrypted, currentPassword, newPassword)
          : { input: await removeNoteExtraPassword(legacyDraft.encrypted, currentPassword, masterKey), noteKey: null };
      const response = await fetch(`/api/notes/${legacyDraft.encrypted.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.input),
      });
      if (!response.ok) throw new Error();
      const { note } = await response.json() as { note: EncryptedNote };
      setLegacyDraft({ ...legacyDraft, encrypted: note, contentKey: result.noteKey });
      setNotes((current) => current.map((item) => item.id === note.id ? note : item));
      setProtectionAction(null);
      toast.success(protectionAction === "remove" ? "Protection removed" : "Protection updated");
    } catch {
      toast.error("The operation could not be completed. Check the password.");
    } finally {
      setWorking(false);
    }
  }

  async function save() {
    if (!draft || !masterKey || !draft.title.trim()) return;
    setWorking(true);
    try {
      const tags = normalizeTags(draft.tags);
      const options = {
        title: draft.title.trim(),
        tags,
        favorite: draft.favorite,
        archived: draft.archived,
        pinned: draft.pinned,
        folderId: draft.folderId,
      };
      const result = selectedId
        ? await updateVaultItem(selectedId, draft.type, draft.payload, masterKey, options)
        : await createVaultItem(draft.type, draft.payload, masterKey, options);
      setEncryptedItems((current) => [
        result.item,
        ...current.filter((item) => item.id !== result.item.id),
      ]);
      setSelectedId(result.item.id);
      workspace.openItem(result.item.id);
      toast.success(selectedId ? "Vault item saved" : "Vault item created");
    } catch {
      toast.error("The vault item could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  async function moveDraftItem(folderId: string | null) {
    if (!draft?.id) return;
    setWorking(true);
    try {
      const { item } = await moveItemToFolder(draft.id, folderId);
      setEncryptedItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      setDraft({ ...draft, folderId, updatedAt: item.updatedAt });
      toast.success("Item moved");
    } catch {
      toast.error("The item could not be moved.");
    } finally {
      setWorking(false);
    }
  }

  async function updateDraftTags(tags: string[]) {
    if (!draft?.id || !masterKey) return;
    setWorking(true);
    try {
      const normalized = normalizeTags(tags);
      const { item } = await updateVaultItemTags(draft, normalized, masterKey);
      setEncryptedItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      setDraft({ ...draft, tags: normalized, updatedAt: item.updatedAt });
      toast.success("Tags updated");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Tags could not be updated.");
    } finally {
      setWorking(false);
    }
  }

  function confirmDelete() {
    if (!selectedId) return;
    toast.warning("Permanently delete this vault item?", {
      id: `delete-vault-item-${selectedId}`,
      duration: Infinity,
      description: "This action cannot be undone.",
      action: { label: "Delete", onClick: () => void remove() },
      cancel: { label: "Cancel", onClick: () => undefined },
    });
  }

  async function remove() {
    if (!selectedId) return;
    const response = await fetch(`/api/vault-items/${selectedId}`, { method: "DELETE" });
    if (!response.ok) return toast.error("The vault item could not be deleted.");
    setEncryptedItems((current) => current.filter((item) => item.id !== selectedId));
    setItems((current) => current.filter((item) => item.id !== selectedId));
    setSelectedId(null);
    setDraft(null);
    workspace.closeItem(selectedId);
    toast.success("Vault item deleted");
  }

  const unifiedItems = useMemo<UnifiedItem[]>(() => [
    ...items.map((item) => ({ ...item, source: "vault" as const })),
    ...notes.map((note) => ({
      id: note.id,
      source: "note" as const,
      noteSummary: note,
      type: "note" as const,
      folderId: note.folderId,
      title: noteTitles[note.id] ?? "Decrypting...",
      payload: { markdown: "" },
      tags: [],
      favorite: note.pinned,
      pinned: note.pinned,
      archived: note.archived,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })),
  ], [items, noteTitles, notes]);

  const filtered = useMemo(() => unifiedItems.filter((item) => {
    if ((view === "all" || view === "recent") && item.archived) return false;
    if (view === "favorites" && (!item.favorite || item.archived)) return false;
    if (view === "archive" && !item.archived) return false;
    if (view === "uncategorized" && (item.archived || item.folderId !== null)) return false;
    if (activeFolderId !== null && item.folderId !== activeFolderId) return false;
    if (activeTag && !item.tags.includes(activeTag)) return false;
    if (filter !== "all" && item.type !== filter) return false;
    if (!query.trim()) return true;
    const folderName = folderState.folders.find((folder) => folder.id === item.folderId)?.name ?? "";
    return JSON.stringify([item.title, item.tags, item.payload, folderName])
      .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }).sort((left, right) => {
    if (sortMode === "updated-asc") return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    if (sortMode === "created-desc") return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (sortMode === "title-asc") return left.title.localeCompare(right.title);
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  }), [activeFolderId, activeTag, filter, folderState.folders, query, sortMode, unifiedItems, view]);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => {
      if (item.archived) return;
      item.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
    });
    return Array.from(counts.entries()).sort(([leftTag, leftCount], [rightTag, rightCount]) =>
      rightCount - leftCount || leftTag.localeCompare(rightTag),
    );
  }, [items]);
  const tags = useMemo(() => tagCounts.map(([tag]) => tag), [tagCounts]);
  const primaryTags = tags.slice(0, PRIMARY_TAG_LIMIT);
  const secondaryTags = tags.slice(PRIMARY_TAG_LIMIT);
  const activeFolder = folderState.folders.find((folder) => folder.id === activeFolderId);
  const breadcrumbs = folderBreadcrumbs(folderState.folders, activeFolderId);

  function chooseType(next: VaultItemType | "all") {
    setFilter(next);
    workspace.setOrganizationState({ activeTypeFilter: next });
  }

  function chooseFolder(folderId: string | null) {
    setActiveFolderId(folderId);
    workspace.setOrganizationState({ activeFolderId: folderId });
  }

  const activeGroupTitle = activeTag
    ? `#${activeTag}`
    : activeFolder?.name
      ?? (filter !== "all" ? VAULT_ITEM_LABELS[filter] : {
        all: "All Items",
        favorites: "Favorites",
        recent: "Recent",
        archive: "Archive",
        uncategorized: "Uncategorized",
      }[view]);

  const chooseGroup = (nextView: VaultView, options?: { folderId?: string | null; tag?: string | null; type?: VaultItemType | "all" }) => {
    setView(nextView);
    chooseFolder(options?.folderId ?? null);
    setActiveTag(options?.tag ?? null);
    chooseType(options?.type ?? "all");
    setSidebarOpen(false);
    setDetailOpen(false);
  };

  return (
    <div className={`vault-shell ${workspace.sidebarCollapsed ? "sidebar-collapsed" : ""} ${detailOpen ? "detail-open" : ""}`}>
      <header className="vault-topbar">
        <button type="button" className="vault-topbar-brand" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><img src="/icon.svg" alt="" /><strong>Notes</strong></button>
        <label className="vault-search"><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vault..." /><kbd>⌘ K</kbd></label>
        <div className="vault-topbar-actions ml-auto">
          <button type="button" className="vault-new-button" onClick={() => setNewItemOpen((value) => !value)}><span><FiPlus /> New item</span><i><FiChevronDown /></i></button>
          <span className="vault-topbar-divider" />
          <button type="button" className="vault-topbar-action" aria-label="Lock vault"><FiLock /></button>
          <span className="vault-topbar-divider" />
          <a href="/settings/appearance" className="vault-topbar-action" aria-label="Settings"><FiSettings /></a>
          <span className="vault-topbar-divider" />
          <span className="vault-avatar">{email.slice(0, 1).toUpperCase() || "N"}</span>
        </div>
        {newItemOpen ? <div className="vault-new-menu"><NewItemMenu onCreate={startCreate} /></div> : null}
      </header>
      {sidebarOpen ? <button className="vault-overlay" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`vault-sidebar ${sidebarOpen ? "is-open" : ""} ${workspace.sidebarCollapsed ? "is-collapsed" : ""}`}>
        <nav className="vault-nav-scroll">
          <VaultNavButton active={view === "all" && activeFolderId === null && !activeTag && filter === "all"} icon={<FiGrid />} label="All Items" count={unifiedItems.filter((item) => !item.archived).length} onClick={() => chooseGroup("all")} />
          <VaultNavButton active={view === "favorites"} icon={<FiStar />} label="Favorites" count={unifiedItems.filter((item) => item.favorite && !item.archived).length} onClick={() => chooseGroup("favorites")} />
          <VaultNavButton active={view === "recent"} icon={<FiClock />} label="Recent" count={unifiedItems.filter((item) => !item.archived).length} onClick={() => chooseGroup("recent")} />
          <VaultNavButton active={view === "archive"} icon={<FiArchive />} label="Archive" count={unifiedItems.filter((item) => item.archived).length} onClick={() => chooseGroup("archive")} />
          <SectionTitle label="Folders" action={() => setFolderDialog({ mode: "create", parentFolderId: activeFolderId })} />
          <VaultNavButton active={view === "uncategorized"} icon={<FiFolder />} label="Uncategorized" count={unifiedItems.filter((item) => !item.archived && item.folderId === null).length} onClick={() => chooseGroup("uncategorized")} />
          <FolderTree folders={folderState.folders} activeFolderId={activeFolderId} counts={Object.fromEntries(folderState.folders.map((folder) => [folder.id, unifiedItems.filter((item) => !item.archived && item.folderId === folder.id).length]))} onSelect={(id) => chooseGroup("all", { folderId: id })} onRename={(folder) => setFolderDialog({ mode: "rename", folder })} onDelete={setDeleteFolder} />
          <SectionTitle label="Types" />
          {PRIMARY_TYPES.map((type) => <VaultNavButton key={type} active={filter === type} icon={<TypeIcon type={type} />} label={VAULT_ITEM_LABELS[type]} count={unifiedItems.filter((item) => !item.archived && item.type === type).length} onClick={() => chooseGroup("all", { type })} />)}
          <VaultNavButton active={VAULT_ITEM_TYPES.some((type) => !PRIMARY_TYPES.includes(type) && filter === type)} icon={<FiChevronDown className={moreTypesOpen ? "rotate-180" : ""} />} label="More" onClick={() => setMoreTypesOpen((value) => !value)} />
          {moreTypesOpen ? <div className="vault-more-types">{VAULT_ITEM_TYPES.filter((type) => !PRIMARY_TYPES.includes(type)).map((type) => <VaultNavButton key={type} active={filter === type} icon={<TypeIcon type={type} />} label={VAULT_ITEM_LABELS[type]} count={unifiedItems.filter((item) => !item.archived && item.type === type).length} onClick={() => chooseGroup("all", { type })} />)}</div> : null}
          {tags.length ? <><SectionTitle label="Tags" />
            {primaryTags.map((tag) => <VaultNavButton key={tag} active={activeTag === tag} icon={<FiHash />} label={tag} count={tagCounts.find(([value]) => value === tag)?.[1] ?? 0} onClick={() => chooseGroup("all", { tag })} />)}
            {secondaryTags.length ? <><VaultNavButton active={secondaryTags.includes(activeTag ?? "")} icon={<FiChevronDown className={moreTagsOpen ? "rotate-180" : ""} />} label="More" onClick={() => setMoreTagsOpen((value) => !value)} />
              {moreTagsOpen ? <div className="vault-more-tags">{secondaryTags.map((tag) => <VaultNavButton key={tag} active={activeTag === tag} icon={<FiHash />} label={tag} count={tagCounts.find(([value]) => value === tag)?.[1] ?? 0} onClick={() => chooseGroup("all", { tag })} />)}</div> : null}</> : null}
          </> : null}
        </nav>
        <div className="vault-sidebar-footer"><FiLock /><FiRefreshCw /><FiSettings /></div>
      </aside>
      <section className={`vault-list-pane ${detailOpen ? "has-detail" : ""}`}>
        <div className="vault-list-header">
          <div><h1>{activeGroupTitle}</h1><p>{filtered.length} items</p></div>
          <div className="ml-auto flex gap-2">
            <button type="button" className="vault-icon-button" onClick={() => setFilterDialogOpen(true)}><FiFilter /></button>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="vault-select"><option value="updated-desc">Updated</option><option value="updated-asc">Oldest updated</option><option value="created-desc">Created</option><option value="title-asc">Title</option></select>
            <div className="vault-segment"><button type="button" className={displayMode === "list" ? "active" : ""} onClick={() => setDisplayMode("list")}><FiList /></button><button type="button" className={displayMode === "grid" ? "active" : ""} onClick={() => setDisplayMode("grid")}><FiGrid /></button></div>
          </div>
        </div>
        <div className={displayMode === "grid" ? "vault-item-grid" : "vault-item-list"}>
          {filtered.map((item) => <VaultListItem key={`${item.source}-${item.id}`} item={item} selected={selectedId === item.id} onSelect={() => item.source === "note" ? void selectLegacyNote(item) : selectItem(item)} />)}
          {!filtered.length ? <div className="vault-empty">No items in this group.</div> : null}
        </div>
      </section>
      {draft ? <main className={`vault-detail ${detailOpen ? "is-open" : ""}`}>
        <button type="button" onClick={() => setDetailOpen(false)} className="vault-back"><FiArrowLeft /> Back to {activeGroupTitle}</button>
        {editing
          ? <div className="vault-detail-scroll"><div className="vault-edit-heading"><VaultItemEditIntro type={draft.type} /><button type="button" onClick={() => setEditing(false)} className="vault-secondary-button">Cancel</button></div><VaultItemForm draft={draft} setDraft={setDraft} folders={folderState.folders} working={working} onSave={() => void save().then(() => setEditing(false))} onDelete={selectedId ? confirmDelete : undefined} /></div>
          : <VaultItemPreview item={draft} folders={breadcrumbs} allFolders={folderState.folders} working={working} onEdit={() => setEditing(true)} onFavorite={() => setDraft({ ...draft, favorite: !draft.favorite })} onFolder={(folderId) => void moveDraftItem(folderId)} onTags={(tags) => void updateDraftTags(tags)} />}
      </main> : null}
      {legacyDraft ? <main className={`vault-detail ${detailOpen ? "is-open" : ""}`}>
        <button type="button" onClick={() => setDetailOpen(false)} className="vault-back"><FiArrowLeft /> Back to {activeGroupTitle}</button>
        <LegacyNoteDetail note={legacyDraft} editing={editing} working={working} folders={folderState.folders} onEdit={() => setEditing(true)} onCancel={() => setEditing(false)} onChange={setLegacyDraft} onSave={() => void saveLegacyNote()} onPin={() => void updateLegacyMetadata({ pinned: !legacyDraft.pinned })} onArchive={() => void updateLegacyMetadata({ archived: !legacyDraft.archived })} onFolder={(folderId) => void moveLegacyNote(folderId)} onCritical={() => void setLegacyCritical(!legacyDraft.encrypted.isCritical)} onProtection={setProtectionAction} onDelete={confirmDeleteLegacyNote} onLocalAI={() => setLocalAIOpen(true)} />
      </main> : null}
      <button type="button" title={workspace.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} aria-label={workspace.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} onClick={() => workspace.setSidebarCollapsed(!workspace.sidebarCollapsed)} className="vault-sidebar-toggle">{workspace.sidebarCollapsed ? <FiChevronRight /> : <FiChevronLeft />}</button>
      {filterDialogOpen ? <FilterDialog type={filter} folderId={activeFolderId} tag={activeTag} folders={folderState.folders} tags={tags} onClose={() => setFilterDialogOpen(false)} onApply={(next) => { setFilter(next.type); setActiveFolderId(next.folderId); setActiveTag(next.tag); setFilterDialogOpen(false); }} /> : null}
      {protectedNote ? <ProtectedNoteDialog working={working} onClose={() => setProtectedNote(null)} onUnlock={(password) => void unlockLegacyNote(password)} /> : null}
      {protectionAction ? <NoteProtectionDialog mode={protectionAction} working={working} onClose={() => setProtectionAction(null)} onSubmit={(currentPassword, newPassword) => void handleProtectionAction(currentPassword, newPassword)} /> : null}
      {localAIOpen && legacyDraft ? <LocalAINoteDialog note={legacyDraft} onClose={() => setLocalAIOpen(false)} onChange={(changes) => { const next = { ...legacyDraft, ...changes }; setLegacyDraft(next); void saveLegacyNote(next); }} /> : null}
      {folderDialog ? <FolderDialog mode={folderDialog.mode} folder={folderDialog.folder} defaultParentFolderId={folderDialog.parentFolderId} folders={folderState.folders} onClose={() => setFolderDialog(null)} onSubmit={async (name, parentFolderId) => {
        try {
          if (folderDialog.mode === "rename" && folderDialog.folder) {
            await folderState.renameFolder({ ...folderDialog.folder, parentFolderId }, name);
          } else {
            await folderState.createFolder(name, parentFolderId);
          }
          setFolderDialog(null);
          toast.success(folderDialog.mode === "rename" ? "Folder renamed" : "Folder created");
        } catch { toast.error("The folder operation could not be completed."); }
      }} /> : null}
      {deleteFolder ? <FolderDeleteDialog folder={deleteFolder} onClose={() => setDeleteFolder(null)} onDelete={async (strategy) => {
        try { await folderState.deleteFolder(deleteFolder.id, strategy); chooseFolder(null); setDeleteFolder(null); toast.success("Folder deleted safely"); }
        catch { toast.error("The folder could not be deleted."); }
      }} /> : null}
    </div>
  );
}

function NewItemMenu({ onCreate }: { onCreate: (type: VaultItemType) => void }) {
  return <div className="max-h-72 overflow-y-auto p-1">
    {VAULT_ITEM_TYPES.map((type) => <button key={type} type="button" onClick={() => onCreate(type)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800">New {VAULT_ITEM_LABELS[type].toLocaleLowerCase()}</button>)}
  </div>;
}

function SectionTitle({ label, action }: { label: string; action?: () => void }) {
  return <div className="vault-section-title"><span>{label}</span>{action ? <button type="button" onClick={action} aria-label={`Add ${label}`}><FiPlus /></button> : null}</div>;
}

function VaultNavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`vault-nav-button ${active ? "active" : ""}`}><span className="vault-nav-icon">{icon}</span><span className="truncate">{label}</span>{count !== undefined ? <span className="ml-auto text-xs text-slate-400">{count}</span> : null}</button>;
}

function TypeIcon({ type }: { type: VaultItemType }) {
  if (type === "password" || type === "secret" || type === "recovery_codes") return <FiKey />;
  if (type === "server") return <FiServer />;
  if (type === "database") return <FiDatabase />;
  if (type === "identity") return <FiUser />;
  if (type === "secure_note") return <FiShield />;
  if (type === "credit_card") return <FiCreditCard />;
  if (type === "wifi") return <FiWifi />;
  if (type === "bookmark") return <FiBookmark />;
  if (type === "code_snippet") return <FiCode />;
  if (type === "checklist") return <FiCheckSquare />;
  if (type === "software_license") return <FiKey />;
  return <FiFileText />;
}

function VaultItemEditIntro({ type }: { type: VaultItemType }) {
  return <div className="vault-item-edit-intro">
    <span className={`type-${type}`}><TypeIcon type={type} /></span>
    <div><h2>{VAULT_ITEM_LABELS[type]}</h2><p>{VAULT_ITEM_DESCRIPTIONS[type]}</p></div>
  </div>;
}

function ItemVisual({ type, payload, large = false }: { type: VaultItemType; payload: Record<string, unknown>; large?: boolean }) {
  const faviconUrls = useMemo(() => "url" in payload ? getFaviconUrls(String(payload.url ?? "")) : [], [payload]);
  const [faviconIndex, setFaviconIndex] = useState(0);
  const [faviconColor, setFaviconColor] = useState<string | null>(null);
  useEffect(() => { setFaviconIndex(0); setFaviconColor(null); }, [faviconUrls]);
  const className = large ? "vault-preview-icon" : "vault-type-tile";
  const faviconUrl = faviconUrls[faviconIndex];
  if (faviconUrl) {
    return <span className={`${className} vault-favicon`} style={faviconColor ? { "--favicon-color": faviconColor } as React.CSSProperties : undefined}><img src={faviconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={(event) => setFaviconColor(getDominantFaviconColor(event.currentTarget))} onError={() => setFaviconIndex((index) => index + 1)} /></span>;
  }
  return <span className={`${className} type-${type}`}><TypeIcon type={type} /></span>;
}

function getFaviconUrls(value: string) {
  const candidate = value.trim();
  if (!candidate) return [];
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    if (url.protocol !== "https:") return [];
    return [
      `/api/favicon?domain=${encodeURIComponent(url.hostname)}`,
      `${url.origin}/favicon.ico`,
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=128`,
    ];
  } catch {
    return [];
  }
}

function getDominantFaviconColor(image: HTMLImageElement) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const [r, g, b, alpha] = [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
      const maximum = Math.max(r, g, b);
      const minimum = Math.min(r, g, b);
      const saturation = maximum - minimum;
      if (alpha < 128 || saturation < 30 || maximum > 245 || maximum < 25) continue;
      const pixelWeight = saturation * (alpha / 255);
      red += r * pixelWeight;
      green += g * pixelWeight;
      blue += b * pixelWeight;
      weight += pixelWeight;
    }
    if (!weight) return null;
    return `rgb(${Math.round(red / weight)} ${Math.round(green / weight)} ${Math.round(blue / weight)})`;
  } catch {
    return null;
  }
}

function VaultListItem({ item, selected, onSelect }: { item: UnifiedItem; selected: boolean; onSelect: () => void }) {
  const payload = item.payload as Record<string, unknown>;
  const subtitle = item.type === "password"
    ? String(payload.username || payload.url || "Password")
    : item.type === "server"
      ? String(payload.host || payload.ip || "Server")
      : item.type === "database"
        ? String(payload.host || payload.database || "Database")
        : item.tags.length ? item.tags.map((tag) => `#${tag}`).join("  ") : VAULT_ITEM_LABELS[item.type];
  return <button type="button" onClick={onSelect} className={`vault-list-item ${selected ? "active" : ""}`}>
    <ItemVisual type={item.type} payload={payload} />
    <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="truncate">{item.title || "Untitled"}</strong><em>{item.source === "note" ? "Note" : VAULT_ITEM_LABELS[item.type]}</em></span><span className="block truncate text-sm text-slate-400">{item.source === "note" ? "Encrypted note" : subtitle}</span></span>
    <span className="shrink-0 text-xs text-slate-400">{formatRelativeDate(item.updatedAt)}</span>
    <FiStar className={item.favorite ? "fill-amber-400 text-amber-400" : "text-slate-400"} />
  </button>;
}

function FolderTree({ folders, activeFolderId, counts, onSelect, onRename, onDelete }: {
  folders: Folder[];
  activeFolderId: string | null;
  counts?: Record<string, number>;
  onSelect: (folderId: string) => void;
  onRename: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
} & { counts?: Record<string, number> }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(
    folders.filter((folder) => folders.some((child) => child.parentFolderId === folder.id)).map((folder) => folder.id),
  ));
  const childrenOf = (parentFolderId: string | null) =>
    folders.filter((folder) => folder.parentFolderId === parentFolderId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const toggle = (folderId: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    return next;
  });
  const render = (parentFolderId: string | null, depth = 0): React.ReactNode =>
    childrenOf(parentFolderId).map((folder) => {
      const children = childrenOf(folder.id);
      const hasChildren = children.length > 0;
      const isExpanded = expanded.has(folder.id);
      return <div key={folder.id} className={`vault-folder-node depth-${Math.min(depth, 4)}`}>
        <div className={`vault-folder-row group ${activeFolderId === folder.id ? "active" : ""}`}>
          <button type="button" disabled={!hasChildren} onClick={() => toggle(folder.id)} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${folder.name}`} className={`vault-folder-chevron ${hasChildren ? "" : "invisible"}`}><FiChevronDown className={isExpanded ? "" : "-rotate-90"} /></button>
          <button type="button" onClick={() => onSelect(folder.id)} className="vault-folder-select"><FiFolder /><span className="truncate">{folder.name}</span>{counts ? <span className="vault-folder-count">{counts[folder.id] ?? 0}</span> : null}</button>
          <span className="vault-folder-actions"><button type="button" onClick={() => onRename(folder)} aria-label={`Manage ${folder.name}`}><FiEdit3 /></button><button type="button" onClick={() => onDelete(folder)} aria-label={`Delete ${folder.name}`}><FiTrash2 /></button></span>
        </div>
        {hasChildren && isExpanded && depth < 4 ? <div className="vault-folder-children">{render(folder.id, depth + 1)}</div> : null}
      </div>;
    });
  return <div className="vault-folder-tree">{render(null)}</div>;
}

function VaultItemPreview({ item, folders, allFolders, working, onEdit, onFavorite, onFolder, onTags }: {
  item: VaultItem;
  folders: Folder[];
  allFolders: Folder[];
  working: boolean;
  onEdit: () => void;
  onFavorite: () => void;
  onFolder: (folderId: string | null) => void;
  onTags: (tags: string[]) => void;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [folderOpen, setFolderOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const payload = item.payload as Record<string, unknown>;
  return <div className="vault-detail-scroll">
    <div className="vault-breadcrumbs"><FiFolder /><span>{folders.length ? folders.map((folder) => folder.name).join("  ›  ") : "Uncategorized"}</span><button type="button" disabled={working} onClick={() => setFolderOpen((open) => !open)}><FiEdit3 /> Move</button></div>
    {folderOpen ? <div className="vault-preview-quick-edit"><FolderCombobox label="Move to folder" value={item.folderId} folders={allFolders} onChange={(folderId) => { onFolder(folderId); setFolderOpen(false); }} compact /></div> : null}
    <header className="vault-preview-header">
      <ItemVisual type={item.type} payload={payload} large />
      <div className="min-w-0 flex-1"><h2>{item.title || "Untitled"}</h2><div className="vault-tags"><span className="vault-type-chip">{VAULT_ITEM_LABELS[item.type]}</span>{folders.at(-1) ? <span className="vault-folder-chip">{folders.at(-1)!.name}</span> : null}{item.tags.map((tag) => <span className="vault-tag-chip" key={tag}># {tag}</span>)}<button type="button" disabled={working} className="vault-tags-manage" onClick={() => setTagsOpen((open) => !open)}><FiPlus /> Manage tags</button></div><p>Updated {formatHumanDate(item.updatedAt)} &nbsp;&nbsp; Created {formatHumanDate(item.createdAt)}</p></div>
      <button type="button" onClick={onFavorite} className="vault-icon-button"><FiStar className={item.favorite ? "fill-amber-400 text-amber-400" : ""} /></button><button type="button" className="vault-icon-button"><FiMoreVertical /></button>
    </header>
    {tagsOpen ? <div className="vault-preview-quick-edit vault-preview-tags-editor"><TagInput tags={item.tags} onChange={onTags} compact /></div> : null}
    <div className="vault-preview-tabs"><button className="active">Details</button><button>Notes</button><button>History</button><button type="button" className="ml-auto vault-secondary-button" onClick={onEdit}><FiEdit3 /> Edit</button></div>
    <section className="vault-detail-card">
      {Object.entries(item.payload).map(([field, rawValue]) => {
        const sensitive = SENSITIVE_FIELDS.has(field);
        const value = Array.isArray(rawValue) ? rawValue.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join("\n") : String(rawValue ?? "");
        return <div className="vault-preview-field" key={field}><div><span>{FIELD_LABELS[field] ?? field}</span><p className={sensitive && !revealed[field] ? "vault-secret" : ""}>{sensitive && !revealed[field] ? "••••••••••••••" : value || "—"}</p></div><div className="flex gap-2">{sensitive ? <button type="button" className="vault-icon-button" onClick={() => setRevealed((current) => ({ ...current, [field]: !current[field] }))}>{revealed[field] ? <FiEyeOff /> : <FiEye />}</button> : null}<button type="button" className="vault-icon-button" onClick={() => void copySensitiveValue(value).then(() => toast.success("Copied; clipboard will clear in 30 seconds"))}><FiCopy /></button></div></div>;
      })}
    </section>
    <section className="vault-detail-card vault-meta-card"><div><span>Folder</span><p className="vault-folder-value"><FiFolder /> {folders.at(-1)?.name ?? "Uncategorized"}</p></div><div><span>Tags</span><p className="vault-tags">{item.tags.length ? item.tags.map((tag) => <em className="vault-tag-chip" key={tag}># {tag}</em>) : "No tags"}</p></div><div><span>Created</span><p>{formatDateTime(item.createdAt)}</p></div><div><span>Updated</span><p>{formatDateTime(item.updatedAt)}</p></div></section>
  </div>;
}

function LegacyNoteDetail({ note, editing, working, folders, onEdit, onCancel, onChange, onSave, onPin, onArchive, onFolder, onCritical, onProtection, onDelete, onLocalAI }: {
  note: LegacyNoteDraft;
  editing: boolean;
  working: boolean;
  folders: Folder[];
  onEdit: () => void;
  onCancel: () => void;
  onChange: (note: LegacyNoteDraft) => void;
  onSave: () => void;
  onPin: () => void;
  onArchive: () => void;
  onFolder: (folderId: string | null) => void;
  onCritical: () => void;
  onProtection: (mode: NoteProtectionAction) => void;
  onDelete: () => void;
  onLocalAI: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const breadcrumbs = folderBreadcrumbs(folders, note.encrypted.folderId);
  const copy = () => void navigator.clipboard.writeText(note.content).then(() => toast.success("Note copied"));
  if (editing) {
    return <div className="vault-detail-scroll">
      <div className="vault-edit-heading"><VaultItemEditIntro type="note" /><button type="button" onClick={onCancel} className="vault-secondary-button">Cancel</button></div>
      <div className="vault-legacy-note-fields">
        <label>Title<input value={note.title} onChange={(event) => onChange({ ...note, title: event.target.value })} /></label>
        <FolderCombobox label="Folder" value={note.encrypted.folderId} folders={folders} onChange={onFolder} />
      </div>
      <div className="mt-5" data-color-mode="dark"><MDEditor value={note.content} onChange={(content) => onChange({ ...note, content: content ?? "" })} preview="edit" height={500} /></div>
      <div className="mt-5 flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={note.pinned} onChange={(event) => onChange({ ...note, pinned: event.target.checked })} />Favorite</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={note.archived} onChange={(event) => onChange({ ...note, archived: event.target.checked })} />Archived</label><button type="button" disabled={working} onClick={onSave} className="vault-primary-button ml-auto"><FiSave /> Save note</button></div>
    </div>;
  }
  return <div className="vault-detail-scroll">
    <div className="vault-breadcrumbs"><FiFolder /><span>{breadcrumbs.length ? breadcrumbs.map((folder) => folder.name).join("  ›  ") : "Uncategorized"}</span><button type="button" disabled={working} onClick={() => setFolderOpen((open) => !open)}><FiEdit3 /> Move</button></div>
    {folderOpen ? <div className="vault-preview-quick-edit"><FolderCombobox label="Move to folder" value={note.encrypted.folderId} folders={folders} onChange={(folderId) => { onFolder(folderId); setFolderOpen(false); }} compact /></div> : null}
    <header className="vault-preview-header"><span className="vault-preview-icon type-note"><FiFileText /></span><div className="min-w-0 flex-1"><h2>{note.title || "Untitled"}</h2><div className="vault-tags"><span className="vault-type-chip">Note</span>{breadcrumbs.at(-1) ? <span className="vault-folder-chip">{breadcrumbs.at(-1)!.name}</span> : null}{note.encrypted.isCritical ? <span className="vault-tag-chip">Critical</span> : null}</div><p>Updated {formatHumanDate(note.encrypted.updatedAt)} &nbsp;&nbsp; Created {formatHumanDate(note.encrypted.createdAt)}</p></div><button type="button" className="vault-icon-button" onClick={onPin}><FiStar className={note.pinned ? "fill-amber-400 text-amber-400" : "text-slate-400"} /></button><button type="button" className="vault-secondary-button" onClick={onEdit}><FiEdit3 /> Edit</button><div className="vault-note-menu-anchor"><button type="button" className="vault-icon-button" onClick={() => setMenuOpen((value) => !value)}><FiMoreVertical /></button>{menuOpen ? <NoteActionsMenu note={note} folders={folders} working={working} onClose={() => setMenuOpen(false)} onCopy={copy} onPin={onPin} onArchive={onArchive} onFolder={onFolder} onCritical={onCritical} onProtection={onProtection} onDelete={onDelete} onLocalAI={onLocalAI} /> : null}</div></header>
    <div className="vault-preview-tabs"><button className="active">Note</button><button>History</button></div>
    <section className="vault-detail-card vault-note-content"><button type="button" title="Copy note" aria-label="Copy note" className="vault-note-content-copy" onClick={copy}><FiCopy /></button>{note.content ? <MDEditor.Markdown source={note.content} /> : <p className="text-slate-400">This note has no content.</p>}</section>
  </div>;
}

function NoteActionsMenu({ note, folders, working, onClose, onCopy, onPin, onArchive, onFolder, onCritical, onProtection, onDelete, onLocalAI }: {
  note: LegacyNoteDraft; folders: Folder[]; working: boolean; onClose: () => void; onCopy: () => void; onPin: () => void; onArchive: () => void; onFolder: (id: string | null) => void; onCritical: () => void; onProtection: (mode: NoteProtectionAction) => void; onDelete: () => void; onLocalAI: () => void;
}) {
  const action = (run: () => void) => { run(); onClose(); };
  return <div className="vault-note-menu">
    <MenuLabel label="Note" />
    <MenuAction icon={<FiCopy />} label="Copy" onClick={() => action(onCopy)} />
    <MenuAction icon={<FiStar />} label={note.pinned ? "Unpin" : "Pin"} onClick={() => action(onPin)} />
    <MenuAction icon={<FiArchive />} label={note.archived ? "Unarchive" : "Archive"} onClick={() => action(onArchive)} />
    <div className="vault-menu-folder"><FolderCombobox label="Folder" value={note.encrypted.folderId} folders={folders} onChange={(folderId) => action(() => onFolder(folderId))} compact /></div>
    <MenuDivider />
    <MenuLabel label="Intelligence" /><MenuAction icon={<FiCpu />} label="Local AI" onClick={() => action(onLocalAI)} />
    <MenuDivider />
    <MenuLabel label="Security" /><MenuAction icon={<FiAlertTriangle />} label={note.encrypted.isCritical ? "Remove critical mode" : "Mark as critical"} disabled={working} onClick={() => action(onCritical)} />
    {note.encrypted.hasExtraPassword ? <><MenuAction icon={<FiKey />} label="Change password" onClick={() => action(() => onProtection("change"))} /><MenuAction icon={<FiUnlock />} label="Remove protection" onClick={() => action(() => onProtection("remove"))} /></> : <MenuAction icon={<FiShield />} label="Protect note" onClick={() => action(() => onProtection("protect"))} />}
    <MenuDivider /><MenuLabel label="Danger zone" /><MenuAction danger icon={<FiTrash2 />} label="Delete" onClick={() => action(onDelete)} />
  </div>;
}

function MenuLabel({ label }: { label: string }) { return <p className="vault-menu-label">{label}</p>; }
function MenuDivider() { return <div className="vault-menu-divider" />; }
function MenuAction({ icon, label, danger, disabled, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`vault-menu-action ${danger ? "danger" : ""}`}>{icon}<span>{label}</span></button>;
}

function FilterDialog({ type, folderId, tag, folders, tags, onClose, onApply }: { type: VaultItemType | "all"; folderId: string | null; tag: string | null; folders: Folder[]; tags: string[]; onClose: () => void; onApply: (value: { type: VaultItemType | "all"; folderId: string | null; tag: string | null }) => void }) {
  const [nextType, setNextType] = useState(type);
  const [nextFolder, setNextFolder] = useState(folderId);
  const [nextTag, setNextTag] = useState(tag);
  return <div className="vault-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="vault-dialog"><header><div><h3>Filter items</h3><p>Combine filters to narrow this group.</p></div><button type="button" className="vault-icon-button" onClick={onClose}><FiX /></button></header><label>Type<select value={nextType} onChange={(event) => setNextType(event.target.value as VaultItemType | "all")}><option value="all">All types</option>{VAULT_ITEM_TYPES.map((value) => <option value={value} key={value}>{VAULT_ITEM_LABELS[value]}</option>)}</select></label><FolderCombobox label="Folder" value={nextFolder} folders={folders} emptyLabel="All folders" onChange={setNextFolder} /><label>Tag<select value={nextTag ?? ""} onChange={(event) => setNextTag(event.target.value || null)}><option value="">All tags</option>{tags.map((value) => <option value={value} key={value}># {value}</option>)}</select></label><footer><button type="button" className="vault-secondary-button" onClick={() => { setNextType("all"); setNextFolder(null); setNextTag(null); }}>Clear</button><button type="button" className="vault-primary-button" onClick={() => onApply({ type: nextType, folderId: nextFolder, tag: nextTag })}>Apply filters</button></footer></section></div>;
}

function ProtectedNoteDialog({ working, onClose, onUnlock }: { working: boolean; onClose: () => void; onUnlock: (password: string) => void }) {
  const [password, setPassword] = useState("");
  return <div className="vault-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="vault-dialog" onSubmit={(event) => { event.preventDefault(); onUnlock(password); }}><header><div><h3>Unlock protected note</h3><p>Enter the additional password for this note.</p></div><button type="button" className="vault-icon-button" onClick={onClose}><FiX /></button></header><label>Password<input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 block w-full rounded-lg border border-[#202938] bg-[#0b111a] px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500" /></label><footer><button type="button" className="vault-secondary-button" onClick={onClose}>Cancel</button><button disabled={working || !password} className="vault-primary-button"><FiUnlock /> Unlock</button></footer></form></div>;
}

function NoteProtectionDialog({ mode, working, onClose, onSubmit }: { mode: NoteProtectionAction; working: boolean; onClose: () => void; onSubmit: (currentPassword: string, newPassword: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const needsCurrent = mode !== "protect";
  const needsNew = mode !== "remove";
  return <div className="vault-dialog-backdrop"><form className="vault-dialog" onSubmit={(event) => { event.preventDefault(); onSubmit(current, next); }}><header><div><h3>{mode === "protect" ? "Protect note" : mode === "change" ? "Change password" : "Remove protection"}</h3><p>This password is never sent to the server and cannot be recovered.</p></div><button type="button" className="vault-icon-button" onClick={onClose}><FiX /></button></header>{needsCurrent ? <label>Current password<input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} /></label> : null}{needsNew ? <><label>New password<input type="password" value={next} onChange={(event) => setNext(event.target.value)} /></label><label>Confirm password<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label></> : null}<footer><button type="button" className="vault-secondary-button" onClick={onClose}>Cancel</button><button disabled={working || (needsCurrent && !current) || (needsNew && (!next || next !== confirmation))} className="vault-primary-button">Continue</button></footer></form></div>;
}

function LocalAINoteDialog({ note, onClose, onChange }: { note: LegacyNoteDraft; onClose: () => void; onChange: (changes: Partial<Pick<LegacyNoteDraft, "title" | "content">>) => void }) {
  const [capabilities, setCapabilities] = useState<LocalAICapabilities | null>(null);
  const [result, setResult] = useState("");
  const [action, setAction] = useState<"summary" | "title" | "tasks" | null>(null);
  const [working, setWorking] = useState(true);
  useEffect(() => { void getLocalAICapabilities().then(setCapabilities).finally(() => setWorking(false)); }, []);
  const run = async (next: "summary" | "title" | "tasks") => {
    setWorking(true); setAction(next); setResult("");
    try {
      setResult(next === "summary" ? await summarizeText(note.content) : next === "title" ? await suggestTitle(note.content) : await extractTasks(note.content));
    } catch { toast.error("This Local AI action is unavailable in this browser."); }
    finally { setWorking(false); }
  };
  const available = capabilities && Object.values(capabilities).some((value) => value !== "unavailable");
  return <div className="vault-dialog-backdrop"><section className="vault-dialog vault-ai-dialog"><header><div><h3 className="flex items-center gap-2"><FiCpu /> Local AI</h3><p>Actions run locally in your browser when supported.</p></div><button type="button" className="vault-icon-button" onClick={onClose}><FiX /></button></header><div className="vault-ai-actions"><button disabled={working || !available} onClick={() => void run("summary")}>Summarize note</button><button disabled={working || !available} onClick={() => void run("title")}>Suggest title</button><button disabled={working || !available} onClick={() => void run("tasks")}>Extract tasks</button></div>{!working && !available ? <p className="mt-4 text-sm text-slate-400">Local AI is unavailable in this browser or device.</p> : null}{result ? <div className="vault-ai-result"><pre>{result}</pre><button className="vault-primary-button" onClick={() => { if (action === "title") onChange({ title: result }); else onChange({ content: `${note.content}\n\n${result}` }); onClose(); }}>{action === "title" ? "Use title" : "Insert into note"}</button></div> : null}</section></div>;
}

function formatRelativeDate(value: string) {
  const difference = Date.now() - Date.parse(value);
  if (!Number.isFinite(difference) || difference < 0) return "now";
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateTime(value: string) {
  if (!value) return "Not saved yet";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatHumanDate(value: string) {
  if (!value) return "not saved yet";
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  if (days > 1 && days < 7) {
    return `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date)} at ${time}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

function FolderDialog({ mode, folder, defaultParentFolderId, folders, onClose, onSubmit }: {
  mode: "create" | "rename";
  folder?: Folder;
  defaultParentFolderId?: string | null;
  folders: Folder[];
  onClose: () => void;
  onSubmit: (name: string, parentFolderId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [parentFolderId, setParentFolderId] = useState(folder?.parentFolderId ?? defaultParentFolderId ?? null);
  return <div className="vault-dialog-backdrop">
    <form onSubmit={(event) => { event.preventDefault(); void onSubmit(name, parentFolderId); }} className="vault-dialog">
      <h3 className="font-semibold">{mode === "create" ? "Create folder" : "Rename or move folder"}</h3>
      <Field label="Folder name" value={name} onChange={setName} />
      <FolderCombobox label="Parent folder" value={parentFolderId} folders={folders.filter((candidate) => candidate.id !== folder?.id)} emptyLabel="No parent" onChange={setParentFolderId} />
      <footer><button type="button" onClick={onClose} className="vault-secondary-button">Cancel</button><button disabled={!name.trim()} className="vault-primary-button disabled:opacity-50">Save folder</button></footer>
    </form>
  </div>;
}

function folderBreadcrumbs(folders: Folder[], folderId: string | null) {
  const result: Folder[] = [];
  const visited = new Set<string>();
  let current = folderId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const folder = folders.find((item) => item.id === current);
    if (!folder) break;
    result.unshift(folder);
    current = folder.parentFolderId;
  }
  return result;
}

function ItemBreadcrumbs({ folders, activeTag }: { folders: Folder[]; activeTag: string | null }) {
  if (activeTag) return <p className="text-xs text-zinc-500">Personal Vault / #{activeTag}</p>;
  if (folders.length) return <p className="text-xs text-zinc-500">Personal Vault / {folders.map((folder) => folder.name).join(" / ")}</p>;
  return <p className="text-xs text-zinc-500">Sensitive values are encrypted in this browser before saving.</p>;
}

function FolderDeleteDialog({ folder, onClose, onDelete }: { folder: Folder; onClose: () => void; onDelete: (strategy: FolderDeleteStrategy) => Promise<void> }) {
  const [strategy, setStrategy] = useState<FolderDeleteStrategy>("move-to-parent");
  return <div className="vault-dialog-backdrop">
    <section className="vault-dialog">
      <h3 className="font-semibold">Delete “{folder.name}” safely</h3>
      <p className="mt-1 text-xs text-zinc-500">Items are never permanently deleted by this action.</p>
      <div className="mt-4 space-y-2 text-sm">
        {([
          ["move-to-parent", "Delete folder and move items to its parent"],
          ["uncategorized", "Move items to Uncategorized"],
          ["archive-items", "Delete folder and archive its items"],
        ] as const).map(([value, label]) => <label key={value} className="flex items-start gap-2"><input type="radio" checked={strategy === value} onChange={() => setStrategy(value)} />{label}</label>)}
      </div>
      <footer><button type="button" onClick={onClose} className="vault-secondary-button">Cancel</button><button type="button" onClick={() => void onDelete(strategy)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Delete folder</button></footer>
    </section>
  </div>;
}

function VaultItemForm({ draft, setDraft, folders, working, onSave, onDelete }: {
  draft: VaultItem;
  setDraft: (draft: VaultItem) => void;
  folders: Folder[];
  working: boolean;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [generator, setGenerator] = useState({
    length: 24,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: true,
    avoidRepeats: true,
  });
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const setPayload = (field: string, value: unknown) =>
    setDraft({ ...draft, payload: { ...draft.payload, [field]: value } });
  const generatePassword = () => {
    try {
      setGeneratedPassword(generateSecurePassword(generator));
    } catch {
      toast.error("Choose a valid password length and at least one character group.");
    }
  };
  const openGenerator = () => {
    setGeneratorOpen(true);
    setGeneratedPassword("");
    window.setTimeout(generatePassword, 0);
  };
  const useGeneratedPassword = () => {
    if (!generatedPassword) return;
    setPayload("password", generatedPassword);
    setRevealed((current) => ({ ...current, password: true }));
    setGeneratorOpen(false);
    setGeneratedPassword("");
    toast.success("Generated password added to the item");
  };
  const confirmReveal = (field: string) => {
    if (revealed[field]) {
      setRevealed((current) => ({ ...current, [field]: false }));
      return;
    }
    toast.warning(`Reveal ${FIELD_LABELS[field] ?? field}?`, {
      id: `reveal-vault-field-${field}`,
      description: "Make sure nobody can see your screen.",
      action: {
        label: "Reveal",
        onClick: () => setRevealed((current) => ({ ...current, [field]: true })),
      },
      cancel: { label: "Cancel", onClick: () => undefined },
    });
  };

  return <div className="vault-generic-item-form mt-5 space-y-4">
    <section className="vault-item-metadata">
      <label className="vault-metadata-title"><span>Title</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Untitled item" /></label>
      <FolderCombobox label="Folder" value={draft.folderId} folders={folders} onChange={(folderId) => setDraft({ ...draft, folderId })} compact />
      <TagInput tags={draft.tags} onChange={(tags) => setDraft({ ...draft, tags })} compact />
    </section>
    <div className="grid gap-4 md:grid-cols-2">
      {Object.entries(draft.payload).map(([field, rawValue]) => {
        if (draft.type === "code_snippet" && field === "language") return null;
        const sensitive = SENSITIVE_FIELDS.has(field);
        const multiline = ["markdown", "notes", "text", "code", "codes", "items"].includes(field);
        const value = field === "codes"
          ? (rawValue as string[]).join("\n")
          : field === "items"
            ? (rawValue as { text: string }[]).map((item) => item.text).join("\n")
            : String(rawValue ?? "");
        if (field === "markdown") {
          return <label key={field} className="vault-form-card md:col-span-2">
            {FIELD_LABELS[field]}
            <div data-color-mode={document.documentElement.classList.contains("dark") ? "dark" : "light"} className="mt-1">
              <MDEditor value={value} onChange={(next) => setPayload(field, next ?? "")} preview="edit" height={360} />
            </div>
          </label>;
        }
        if (field === "code") {
          return <CodeEditorField
            key={field}
            value={value}
            language={String((draft.payload as Record<string, unknown>).language || "")}
            onLanguageChange={(language) => setPayload("language", language)}
            onChange={(next) => setPayload(field, next)}
          />;
        }
        return <Field
          key={field}
          label={FIELD_LABELS[field] ?? field}
          value={value}
          multiline={multiline}
          secret={sensitive && !revealed[field]}
          type={field === "url" ? "url" : field === "accountEmail" ? "email" : field === "expiresAt" ? "date" : "text"}
          inputMode={field === "number" || field === "cvv" || field === "expiryMonth" || field === "expiryYear" || field === "port" ? "numeric" : undefined}
          placeholder={field === "number" ? "1234 5678 9012 3456" : field === "expiryMonth" ? "MM" : field === "expiryYear" ? "YYYY" : undefined}
          onChange={(next) => setPayload(field,
            field === "port" ? Number(next) || undefined
              : field === "codes" ? next.split("\n").filter(Boolean)
                : field === "items" ? next.split("\n").filter(Boolean).map((text, index) => ({ id: String(index + 1), text, checked: false }))
                  : formatFieldValue(field, next))}
          actions={sensitive || field === "username" ? <>
            {sensitive ? <button type="button" title={revealed[field] ? "Hide" : "Reveal"} onClick={() => confirmReveal(field)} className="rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">{revealed[field] ? <FiEyeOff /> : <FiEye />}</button> : null}
            <button type="button" title="Copy and clear clipboard after 30 seconds" onClick={() => void copySensitiveValue(value).then(() => toast.success("Copied; clipboard will clear in 30 seconds"))} className="rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><FiCopy /></button>
            {draft.type === "password" && field === "password" ? <button type="button" title="Open password generator" onClick={openGenerator} className="rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><FiRefreshCw /></button> : null}
          </> : undefined}
        />;
      })}
    </div>
    <div className="flex flex-wrap gap-4 text-sm">
      {(["favorite", "pinned", "archived"] as const).map((field) => <label key={field} className="flex items-center gap-2 capitalize"><input type="checkbox" checked={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.checked })} />{field}</label>)}
    </div>
    <div className="flex justify-between">
      {onDelete ? <button type="button" onClick={onDelete} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-red-600"><FiTrash2 />Delete</button> : <span />}
      <button type="button" disabled={working || !draft.title.trim()} onClick={onSave} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><FiSave />Save encrypted item</button>
    </div>
    {generatorOpen ? (
      <PasswordGeneratorModal
        options={generator}
        password={generatedPassword}
        onChange={setGenerator}
        onGenerate={generatePassword}
        onUse={useGeneratedPassword}
        onClose={() => {
          setGeneratorOpen(false);
          setGeneratedPassword("");
        }}
      />
    ) : null}
  </div>;
}

function MobilePasswordForm({ draft, setDraft, working, creating, revealed, onToggleReveal, generator, generatedPassword, onGeneratorChange, onGenerate, onUseGenerated, onSave }: {
  draft: VaultItem;
  setDraft: (draft: VaultItem) => void;
  working: boolean;
  creating: boolean;
  revealed: boolean;
  onToggleReveal: () => void;
  generator: PasswordGeneratorOptions;
  generatedPassword: string;
  onGeneratorChange: (options: PasswordGeneratorOptions) => void;
  onGenerate: () => void;
  onUseGenerated: () => void;
  onSave: () => void;
}) {
  const payload = draft.payload as Record<string, unknown>;
  const value = (field: string) => String(payload[field] ?? "");
  const setPayload = (field: string, next: string) => setDraft({
    ...draft,
    payload: { ...draft.payload, [field]: next } as VaultItem["payload"],
  });
  const password = value("password");
  const strength = passwordStrength(password);
  const generated = generatedPassword || password;
  const copy = (next: string) => void copySensitiveValue(next).then(() => toast.success("Copied; clipboard will clear in 30 seconds"));

  return <div className="vault-mobile-password-form">
    <header className="vault-mobile-password-top">
      <span>{creating ? "Nuevo ítem" : "Editar contraseña"}</span>
      <button type="button" disabled={working || !draft.title.trim()} onClick={onSave}>Guardar</button>
    </header>
    <div className="vault-mobile-password-intro">
      <span className="vault-mobile-password-icon"><FiLock /></span>
      <div><h2>Contraseña</h2><p>Guarda un inicio de sesión</p></div>
    </div>

    <MobileSection title="Información básica">
      <MobilePasswordField label="Título" required value={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
      <MobilePasswordField label="URL" value={value("url")} onChange={(next) => setPayload("url", next)} action={<FiGlobe />} />
      <MobilePasswordField label="Usuario" value={value("username")} onChange={(next) => setPayload("username", next)} action={<button type="button" onClick={() => copy(value("username"))}><FiCopy /></button>} />
      <MobilePasswordField label="Contraseña" required secret={!revealed} value={password} onChange={(next) => setPayload("password", next)} action={<><button type="button" onClick={onToggleReveal}>{revealed ? <FiEyeOff /> : <FiEye />}</button><button type="button" onClick={() => copy(password)}><FiCopy /></button></>} />
      <div className="vault-password-strength"><span style={{ width: `${strength.score}%` }} /><i>{strength.label}</i></div>
    </MobileSection>

    <MobileSection title="Generador">
      <div className="vault-mobile-generator-value"><span><small>Generar contraseña</small><strong>{generated || "Pulsa actualizar para generar"}</strong></span><button type="button" onClick={onGenerate}><FiRefreshCw /></button></div>
      {generatedPassword && generatedPassword !== password ? <button type="button" className="vault-mobile-use-password" onClick={onUseGenerated}>Usar contraseña generada</button> : null}
      <label className="vault-mobile-length"><span>Longitud <b>{generator.length}</b></span><input type="range" min="8" max="64" value={generator.length} onChange={(event) => onGeneratorChange({ ...generator, length: Number(event.target.value) })} /></label>
      <div className="vault-mobile-options">
        {([
          ["uppercase", "Mayúsculas (A-Z)"],
          ["lowercase", "Minúsculas (a-z)"],
          ["numbers", "Números (0-9)"],
          ["symbols", "Símbolos (!@#$%^&*)"],
          ["excludeAmbiguous", "Excluir caracteres ambiguos (Il1oO0)"],
        ] as const).map(([option, label]) => <label key={option}><input type="checkbox" checked={generator[option]} onChange={(event) => onGeneratorChange({ ...generator, [option]: event.target.checked })} />{label}</label>)}
      </div>
    </MobileSection>

    <MobileSection title="Opcional">
      <MobilePasswordField label="Notas" multiline value={value("notes")} onChange={(next) => setPayload("notes", next)} placeholder="Notas adicionales..." />
    </MobileSection>

    <MobileSection title="TOTP (2FA)">
      <MobilePasswordField label="Clave secreta (opcional)" value={value("totpSecret")} onChange={(next) => setPayload("totpSecret", next)} action={<button type="button" onClick={() => copy(value("totpSecret"))}><FiCopy /></button>} />
      <p className="vault-mobile-help">Esta clave se usará para generar códigos TOTP.</p>
    </MobileSection>

    <section className="vault-mobile-tags-section">
      <h3>Etiquetas</h3>
      <TagInput tags={draft.tags} onChange={(tags) => setDraft({ ...draft, tags })} />
    </section>
  </div>;
}

function MobileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="vault-mobile-password-section"><h3>{title}</h3><div>{children}</div></section>;
}

function MobilePasswordField({ label, value, onChange, action, required, secret, multiline, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  action?: React.ReactNode;
  required?: boolean;
  secret?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  return <label className="vault-mobile-password-field"><span>{label}{required ? <b> *</b> : null}</span><i>{multiline
    ? <textarea value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} rows={5} />
    : <input type={secret ? "password" : "text"} value={value} placeholder={placeholder} autoComplete="off" onChange={(event) => onChange(event.target.value)} />}
    {action ? <em>{action}</em> : null}</i></label>;
}

function passwordStrength(password: string) {
  if (!password) return { score: 0, label: "Agrega una contraseña" };
  const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const score = Math.min(100, Math.round((Math.min(password.length, 20) / 20) * 55 + (groups / 4) * 45));
  return { score, label: score >= 75 ? "Fuerte" : score >= 45 ? "Media" : "Débil" };
}

interface PasswordGeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  avoidRepeats: boolean;
}

function PasswordGeneratorModal({ options, password, onChange, onGenerate, onUse, onClose }: {
  options: PasswordGeneratorOptions;
  password: string;
  onChange: (options: PasswordGeneratorOptions) => void;
  onGenerate: () => void;
  onUse: () => void;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="fixed inset-0 z-[3100] grid place-items-center bg-black/60 p-4" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section role="dialog" aria-modal="true" aria-labelledby="password-generator-title" className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 id="password-generator-title" className="font-semibold">Password generator</h3>
          <p className="mt-1 text-xs text-zinc-500">Generated locally using Web Crypto.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close password generator" className="rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><FiX /></button>
      </header>
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-300 p-2 dark:border-zinc-700">
        <input readOnly type={visible ? "text" : "password"} value={password} className="min-w-0 flex-1 bg-transparent px-1 font-mono text-sm outline-none" />
        <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Hide generated password" : "Reveal generated password"} className="rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">{visible ? <FiEyeOff /> : <FiEye />}</button>
        <button type="button" onClick={() => void copySensitiveValue(password).then(() => toast.success("Copied; clipboard will clear in 30 seconds"))} aria-label="Copy generated password" className="rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><FiCopy /></button>
      </div>
      <label className="mt-4 block text-xs text-zinc-500">Length: {options.length}
        <input type="range" min="8" max="64" value={options.length} onChange={(event) => onChange({ ...options, length: Number(event.target.value) })} className="mt-1 block w-full" />
      </label>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        {(["uppercase", "lowercase", "numbers", "symbols", "excludeAmbiguous", "avoidRepeats"] as const).map((option) => (
          <label key={option} className="flex items-center gap-2">
            <input type="checkbox" checked={options[option]} onChange={(event) => onChange({ ...options, [option]: event.target.checked })} />
            {option.replace(/([A-Z])/g, " $1").toLocaleLowerCase()}
          </label>
        ))}
      </div>
      <footer className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onGenerate} className="flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700"><FiRefreshCw />Generate</button>
        <button type="button" disabled={!password} onClick={onUse} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Use password</button>
      </footer>
    </section>
  </div>;
}

function TagInput({ tags, onChange, compact = false }: { tags: string[]; onChange: (tags: string[]) => void; compact?: boolean }) {
  const [value, setValue] = useState("");
  const add = () => {
    try {
      const next = normalizeTags([...tags, value]);
      onChange(next);
      setValue("");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Invalid tag.");
    }
  };
  return <div className={compact ? "vault-tags-input is-compact" : "vault-form-card"}>
    <label className="block text-xs font-medium text-zinc-500">Tags</label>
    <div className="mt-1 flex gap-2">
      <input value={value} maxLength={40} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={compact ? "Add tag" : "Add encrypted tag"} className={compact ? "min-w-0 flex-1" : "vault-form-control min-w-0 flex-1"} />
      <button type="button" onClick={add} disabled={!value.trim()} className="rounded-md border border-zinc-300 px-3 text-sm disabled:opacity-50 dark:border-zinc-700">Add</button>
    </div>
    <div className="mt-2 flex flex-wrap gap-1">{tags.map((tag) => <button type="button" key={tag} onClick={() => onChange(tags.filter((value) => value !== tag))} className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] dark:bg-zinc-800">#{tag} ×</button>)}</div>
  </div>;
}

function FolderCombobox({ label, value, folders, onChange, emptyLabel = "Uncategorized", compact = false }: {
  label: string;
  value: string | null;
  folders: Folder[];
  onChange: (folderId: string | null) => void;
  emptyLabel?: string;
  compact?: boolean;
}) {
  const rootRef = useRef<HTMLLabelElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const folderPath = (folder: Folder) => folderBreadcrumbs(folders, folder.id).map((entry) => entry.name).join(" / ");
  const options = [{ id: null, name: emptyLabel }, ...folders.map((folder) => ({ id: folder.id, name: folderPath(folder) }))];
  const selected = options.find((option) => option.id === value) ?? options[0];
  const filtered = options.filter((option) => option.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => setActiveIndex(0), [query]);

  const choose = (option: (typeof options)[number]) => {
    onChange(option.id);
    setQuery("");
    setOpen(false);
  };
  return <label ref={rootRef} className={`vault-folder-combobox ${compact ? "is-compact" : "vault-form-card"}`}>
    <span>{label}</span>
    <div className="vault-folder-combobox-input">
      <FiSearch />
      <input
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={open ? query : selected.name}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1))); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
          if (event.key === "Enter" && open && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); }
          if (event.key === "Escape") { setOpen(false); setQuery(""); }
        }}
      />
      <FiChevronDown />
    </div>
    {open ? <div className="vault-folder-combobox-options" role="listbox">
      {filtered.length ? filtered.map((option, index) => <button type="button" role="option" aria-selected={option.id === value} className={`${index === activeIndex ? "active" : ""} ${option.id === value ? "selected" : ""}`} key={option.id ?? "empty"} onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}><FiFolder /><span>{option.name}</span></button>) : <p>No folders found</p>}
    </div> : null}
  </label>;
}

const CODE_LANGUAGES = [
  ["", "Auto detect"],
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["python", "Python"],
  ["json", "JSON"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["sql", "SQL"],
  ["shell", "Shell"],
  ["markdown", "Markdown"],
  ["yaml", "YAML"],
  ["dockerfile", "Dockerfile"],
  ["plaintext", "Plain text"],
] as const;

function CodeEditorField({ value, language, onChange, onLanguageChange }: {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onLanguageChange: (language: string) => void;
}) {
  const detectedLanguage = detectCodeLanguage(value);
  const activeLanguage = normalizeMonacoLanguage(language || detectedLanguage);
  const detectedLabel = CODE_LANGUAGES.find(([value]) => value === detectedLanguage)?.[1] ?? detectedLanguage;
  return <section className="vault-code-editor-field md:col-span-2">
    <span className="vault-code-editor-toolbar">
      <span><FiCode /> Code</span>
      <label>
        <span className="sr-only">Language</span>
        <select value={language} onChange={(event) => onLanguageChange(event.target.value)}>
          {CODE_LANGUAGES.map(([value, label]) => <option value={value} key={value || "auto"}>{label}{!value ? ` (${detectedLabel})` : ""}</option>)}
        </select>
      </label>
    </span>
    <div className="vault-code-editor">
      <Suspense fallback={<div className="vault-code-editor-loading">Loading code editor...</div>}>
        <MonacoEditor
          height="360px"
          language={activeLanguage}
          value={value}
          theme={typeof document !== "undefined" && document.documentElement.classList.contains("light") ? "light" : "vs-dark"}
          onChange={(next) => onChange(next ?? "")}
          options={{ minimap: { enabled: false }, fontSize: 13, lineNumbersMinChars: 3, padding: { top: 12 }, scrollBeyondLastLine: false, wordWrap: "on" }}
        />
      </Suspense>
    </div>
  </section>;
}

function detectCodeLanguage(code: string) {
  const source = code.trim();
  if (!source) return "plaintext";
  if (/^#!.*\b(?:bash|sh|zsh)\b/.test(source) || /\b(?:echo|fi|done|export)\b/.test(source)) return "shell";
  if (/^(?:FROM|RUN|CMD|ENTRYPOINT|COPY|WORKDIR|EXPOSE)\s/im.test(source)) return "dockerfile";
  if (/^\s*[{[]/.test(source)) {
    try { JSON.parse(source); return "json"; } catch { /* Continue detecting. */ }
  }
  if (/<!doctype html>|<\/?[a-z][\s\S]*>/i.test(source)) return "html";
  if (/(?:^|\n)\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(source)) return "sql";
  if (/(?:^|\n)\s*(?:def |from \S+ import |import \S+|print\(|class \w+[:(])/.test(source)) return "python";
  if (/\b(?:interface|type|enum)\s+\w+|:\s*(?:string|number|boolean)\b/.test(source)) return "typescript";
  if (/\b(?:const|let|var|function|import|export|console\.)\b|=>/.test(source)) return "javascript";
  if (/(?:^|\n)\s*[.#]?[a-z][^{]+\{[^}]*:[^}]*\}/i.test(source)) return "css";
  if (/^(?:---\s*\n)?[\w-]+:\s+\S+/m.test(source)) return "yaml";
  if (/^#{1,6}\s+|^\s*[-*]\s+|\[[^\]]+\]\([^)]+\)/m.test(source)) return "markdown";
  return "plaintext";
}

function normalizeMonacoLanguage(language: string) {
  const normalized = language.trim().toLocaleLowerCase();
  return ({ js: "javascript", ts: "typescript", py: "python", sh: "shell", bash: "shell", yml: "yaml", md: "markdown" } as Record<string, string>)[normalized] || normalized || "plaintext";
}

function formatFieldValue(field: string, value: string) {
  if (field === "number") return value.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
  if (field === "cvv") return value.replace(/\D/g, "").slice(0, 4);
  if (field === "expiryMonth") return value.replace(/\D/g, "").slice(0, 2);
  if (field === "expiryYear") return value.replace(/\D/g, "").slice(0, 4);
  return value;
}

function Field({ label, value, onChange, multiline, secret, actions, type = "text", inputMode, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  secret?: boolean;
  actions?: React.ReactNode;
  type?: React.HTMLInputTypeAttribute;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
}) {
  const className = "vault-form-control mt-1 w-full";
  return <label className={`${multiline ? "md:col-span-2" : ""} vault-form-card`}>
    {label}
    <span className="flex items-start gap-1">
      {multiline ? <textarea value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} rows={6} className={className} /> : <input type={secret ? "password" : type} inputMode={inputMode} placeholder={placeholder} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} className={className} />}
      {actions ? <span className="mt-1 flex">{actions}</span> : null}
    </span>
  </label>;
}
