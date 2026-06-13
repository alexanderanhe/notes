import { useEffect, useMemo, useState } from "react";
import { FiArchive, FiClock, FiCopy, FiEdit3, FiEye, FiEyeOff, FiFolder, FiPlus, FiRefreshCw, FiSave, FiStar, FiTrash2, FiX } from "react-icons/fi";
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
  updateVaultItem,
} from "~/lib/vault-items.client";
import {
  VAULT_ITEM_LABELS,
  VAULT_ITEM_TYPES,
  type EncryptedVaultItem,
  type VaultItem,
  type VaultItemType,
} from "~/lib/vault-items";
import { normalizeTags, type Folder, type FolderDeleteStrategy } from "~/lib/folders";

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

export function VaultItemsPanel({ onClose }: { onClose: () => void }) {
  const { masterKey } = useVault();
  const workspace = useWorkspace();
  const folderState = useFolders();
  const [encryptedItems, setEncryptedItems] = useState<EncryptedVaultItem[]>([]);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<VaultItem | null>(null);
  const [filter, setFilter] = useState<VaultItemType | "all">(workspace.activeTypeFilter as VaultItemType | "all" || "all");
  const [view, setView] = useState<"all" | "favorites" | "recent" | "archive" | "uncategorized">("all");
  const [activeFolderId, setActiveFolderId] = useState<string | null>(workspace.activeFolderId);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ mode: "create" | "rename"; folder?: Folder; parentFolderId?: string | null } | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<Folder | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void loadItems();
  }, []);

  useEffect(() => {
    if (!masterKey) return;
    Promise.all(encryptedItems.map((item) => decryptVaultItemPayload(item, masterKey)))
      .then(setItems)
      .catch(() => toast.error("Vault items could not be decrypted."));
  }, [encryptedItems, masterKey]);

  useEffect(() => {
    if (!workspace.activeItemId || selectedId || !items.length) return;
    const restored = items.find((item) => item.id === workspace.activeItemId);
    if (restored) selectItem(restored);
  }, [items, selectedId, workspace.activeItemId]);

  async function loadItems() {
    const response = await fetch("/api/vault-items");
    if (!response.ok) return toast.error("Vault items could not be loaded.");
    const result = await response.json() as { items: EncryptedVaultItem[] };
    setEncryptedItems(result.items);
  }

  function startCreate(type: VaultItemType) {
    setCreating(false);
    setSelectedId(null);
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
  }

  function selectItem(item: VaultItem) {
    setSelectedId(item.id);
    setDraft(structuredClone(item));
    workspace.openItem(item.id);
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

  const filtered = useMemo(() => items.filter((item) => {
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
  }).sort((left, right) => view === "recent" ? Date.parse(right.updatedAt) - Date.parse(left.updatedAt) : 0), [activeFolderId, activeTag, filter, folderState.folders, items, query, view]);
  const tags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags))).sort(), [items]);
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

  return (
    <div className="fixed inset-0 z-[2500] flex bg-black/60 p-2 sm:p-6">
      <section className="mx-auto flex min-h-0 w-full max-w-6xl overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950">
        <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Personal Vault</h2>
            <button type="button" onClick={() => setCreating((value) => !value)} className="rounded-md bg-blue-600 p-2 text-white" aria-label="New vault item"><FiPlus /></button>
          </div>
          {creating ? <NewItemMenu onCreate={startCreate} /> : null}
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search locally" className="mt-3 rounded-md bg-zinc-100 px-3 py-2 text-sm outline-none dark:bg-zinc-800" />
          <nav className="mt-3 space-y-1">
            <VaultNavButton active={view === "all" && activeFolderId === null && !activeTag} icon={<FiFolder />} label="All Items" onClick={() => { setView("all"); chooseFolder(null); setActiveTag(null); }} />
            <VaultNavButton active={view === "favorites"} icon={<FiStar />} label="Favorites" onClick={() => { setView("favorites"); chooseFolder(null); setActiveTag(null); }} />
            <VaultNavButton active={view === "recent"} icon={<FiClock />} label="Recent" onClick={() => { setView("recent"); chooseFolder(null); setActiveTag(null); }} />
            <VaultNavButton active={view === "archive"} icon={<FiArchive />} label="Archive" onClick={() => { setView("archive"); chooseFolder(null); setActiveTag(null); }} />
          </nav>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Folders</p>
            <button type="button" onClick={() => setFolderDialog({ mode: "create", parentFolderId: activeFolderId })} aria-label="Create folder" className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><FiPlus /></button>
          </div>
          <VaultNavButton active={view === "uncategorized"} icon={<FiFolder />} label="Uncategorized" onClick={() => { setView("uncategorized"); chooseFolder(null); setActiveTag(null); }} />
          <FolderTree folders={folderState.folders} activeFolderId={activeFolderId} onSelect={(id) => { setView("all"); chooseFolder(id); setActiveTag(null); }} onRename={(folder) => setFolderDialog({ mode: "rename", folder })} onDelete={setDeleteFolder} />
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Types</p>
          <select value={filter} onChange={(event) => chooseType(event.target.value as VaultItemType | "all")} className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-2 text-sm dark:border-zinc-700">
            <option value="all">All types</option>
            {VAULT_ITEM_TYPES.map((type) => <option key={type} value={type}>{VAULT_ITEM_LABELS[type]}</option>)}
          </select>
          {tags.length ? <><p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Tags</p><div className="mt-1 flex max-h-20 flex-wrap gap-1 overflow-y-auto">{tags.map((tag) => <button type="button" key={tag} onClick={() => { setActiveTag(activeTag === tag ? null : tag); chooseFolder(null); }} className={`rounded-full px-2 py-1 text-[11px] ${activeTag === tag ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>#{tag}</button>)}</div></> : null}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {filtered.map((item) => (
              <button key={item.id} type="button" onClick={() => selectItem(item)} className={`mb-1 block w-full rounded-md px-3 py-2 text-left ${selectedId === item.id ? "bg-blue-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                <span className="block truncate text-sm font-medium">{item.title || "Untitled"}</span>
                <span className="text-xs opacity-60">{VAULT_ITEM_LABELS[item.type]}</span>
              </button>
            ))}
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{draft ? VAULT_ITEM_LABELS[draft.type] : "Encrypted vault items"}</h2>
              <ItemBreadcrumbs folders={breadcrumbs} activeTag={activeTag} />
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close vault"><FiX /></button>
          </div>
          {draft ? (
            <VaultItemForm draft={draft} setDraft={setDraft} folders={folderState.folders} working={working} onSave={() => void save()} onDelete={selectedId ? confirmDelete : undefined} />
          ) : (
            <div className="grid min-h-80 place-items-center text-sm text-zinc-500">Create or select a vault item.</div>
          )}
        </main>
      </section>
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
  return <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-zinc-200 p-1 dark:border-zinc-700">
    {VAULT_ITEM_TYPES.map((type) => <button key={type} type="button" onClick={() => onCreate(type)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800">New {VAULT_ITEM_LABELS[type].toLocaleLowerCase()}</button>)}
  </div>;
}

function VaultNavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${active ? "bg-zinc-200 font-semibold dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>{icon}{label}</button>;
}

function FolderTree({ folders, activeFolderId, onSelect, onRename, onDelete }: {
  folders: Folder[];
  activeFolderId: string | null;
  onSelect: (folderId: string) => void;
  onRename: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}) {
  const render = (parentFolderId: string | null, depth = 0): React.ReactNode =>
    folders.filter((folder) => folder.parentFolderId === parentFolderId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map((folder) => (
      <div key={folder.id}>
        <div style={{ paddingLeft: depth * 12 }} className={`group flex items-center rounded-md ${activeFolderId === folder.id ? "bg-blue-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
          <button type="button" onClick={() => onSelect(folder.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs"><FiFolder className="shrink-0" /><span className="truncate">{folder.name}</span></button>
          <button type="button" onClick={() => onRename(folder)} aria-label={`Manage ${folder.name}`} className="rounded p-1 opacity-0 group-hover:opacity-100"><FiEdit3 /></button>
          <button type="button" onClick={() => onDelete(folder)} aria-label={`Delete ${folder.name}`} className="rounded p-1 text-red-500 opacity-0 group-hover:opacity-100"><FiTrash2 /></button>
        </div>
        {depth < 4 ? render(folder.id, depth + 1) : null}
      </div>
    ));
  return <div className="mt-1 max-h-36 overflow-y-auto">{render(null)}</div>;
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
  return <div className="fixed inset-0 z-[3200] grid place-items-center bg-black/60 p-4">
    <form onSubmit={(event) => { event.preventDefault(); void onSubmit(name, parentFolderId); }} className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
      <h3 className="font-semibold">{mode === "create" ? "Create folder" : "Rename or move folder"}</h3>
      <Field label="Folder name" value={name} onChange={setName} />
      <label className="mt-4 block text-xs font-medium text-zinc-500">Parent folder
        <select value={parentFolderId ?? ""} onChange={(event) => setParentFolderId(event.target.value || null)} className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700">
          <option value="">No parent</option>
          {folders.filter((candidate) => candidate.id !== folder?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancel</button><button disabled={!name.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save folder</button></div>
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
  return <div className="fixed inset-0 z-[3200] grid place-items-center bg-black/60 p-4">
    <section className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
      <h3 className="font-semibold">Delete “{folder.name}” safely</h3>
      <p className="mt-1 text-xs text-zinc-500">Items are never permanently deleted by this action.</p>
      <div className="mt-4 space-y-2 text-sm">
        {([
          ["move-to-parent", "Delete folder and move items to its parent"],
          ["uncategorized", "Move items to Uncategorized"],
          ["archive-items", "Delete folder and archive its items"],
        ] as const).map(([value, label]) => <label key={value} className="flex items-start gap-2"><input type="radio" checked={strategy === value} onChange={() => setStrategy(value)} />{label}</label>)}
      </div>
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancel</button><button type="button" onClick={() => void onDelete(strategy)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Delete folder</button></div>
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

  return <div className="mt-5 space-y-4">
    <Field label="Title" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
    <TagInput tags={draft.tags} onChange={(tags) => setDraft({ ...draft, tags })} />
    <label className="block text-xs font-medium text-zinc-500">Folder
      <select value={draft.folderId ?? ""} onChange={(event) => setDraft({ ...draft, folderId: event.target.value || null })} className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700">
        <option value="">Uncategorized</option>
        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
    </label>
    <div className="grid gap-4 md:grid-cols-2">
      {Object.entries(draft.payload).map(([field, rawValue]) => {
        const sensitive = SENSITIVE_FIELDS.has(field);
        const multiline = ["markdown", "notes", "text", "code", "codes", "items"].includes(field);
        const value = field === "codes"
          ? (rawValue as string[]).join("\n")
          : field === "items"
            ? (rawValue as { text: string }[]).map((item) => item.text).join("\n")
            : String(rawValue ?? "");
        if (field === "markdown") {
          return <label key={field} className="block text-xs font-medium text-zinc-500 md:col-span-2">
            {FIELD_LABELS[field]}
            <div data-color-mode={document.documentElement.classList.contains("dark") ? "dark" : "light"} className="mt-1">
              <MDEditor value={value} onChange={(next) => setPayload(field, next ?? "")} preview="edit" height={360} />
            </div>
          </label>;
        }
        return <Field
          key={field}
          label={FIELD_LABELS[field] ?? field}
          value={value}
          multiline={multiline}
          secret={sensitive && !revealed[field]}
          onChange={(next) => setPayload(field,
            field === "port" ? Number(next) || undefined
              : field === "codes" ? next.split("\n").filter(Boolean)
                : field === "items" ? next.split("\n").filter(Boolean).map((text, index) => ({ id: String(index + 1), text, checked: false }))
                  : next)}
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

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
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
  return <div>
    <label className="block text-xs font-medium text-zinc-500">Tags</label>
    <div className="mt-1 flex gap-2">
      <input value={value} maxLength={40} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="Add encrypted tag" className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none dark:border-zinc-700" />
      <button type="button" onClick={add} disabled={!value.trim()} className="rounded-md border border-zinc-300 px-3 text-sm disabled:opacity-50 dark:border-zinc-700">Add</button>
    </div>
    <div className="mt-2 flex flex-wrap gap-1">{tags.map((tag) => <button type="button" key={tag} onClick={() => onChange(tags.filter((value) => value !== tag))} className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] dark:bg-zinc-800">#{tag} ×</button>)}</div>
  </div>;
}

function Field({ label, value, onChange, multiline, secret, actions }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  secret?: boolean;
  actions?: React.ReactNode;
}) {
  const className = "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none dark:border-zinc-700";
  return <label className={`${multiline ? "md:col-span-2" : ""} block text-xs font-medium text-zinc-500`}>
    {label}
    <span className="flex items-start gap-1">
      {multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={6} className={className} /> : <input type={secret ? "password" : "text"} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} className={className} />}
      {actions ? <span className="mt-1 flex">{actions}</span> : null}
    </span>
  </label>;
}
