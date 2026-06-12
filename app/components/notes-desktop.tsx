import "@uiw/react-md-editor/markdown-editor.css";

import MDEditor from "@uiw/react-md-editor/nohighlight";
import rehypeSanitize from "rehype-sanitize";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  FiArchive,
  FiCheck,
  FiChevronDown,
  FiChevronUp,
  FiCopy,
  FiCpu,
  FiAlertTriangle,
  FiEdit3,
  FiFileText,
  FiFolder,
  FiKey,
  FiLock,
  FiMaximize2,
  FiMenu,
  FiMinimize2,
  FiMinus,
  FiMonitor,
  FiMoreHorizontal,
  FiMoon,
  FiPlus,
  FiSearch,
  FiSidebar,
  FiShield,
  FiStar,
  FiSun,
  FiTrash2,
  FiUnlock,
  FiUser,
  FiX,
} from "react-icons/fi";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

import { LogoutButton } from "~/components/logout-button";
import { useVault } from "~/contexts/vault-context";
import { useWorkspace } from "~/contexts/workspace-context";
import {
  detectLanguage,
  extractTasks,
  getLocalAICapabilities,
  rewriteText,
  suggestTitle,
  summarizeText,
  translateText,
  type LocalAIAvailability,
  type LocalAICapabilities,
} from "~/lib/local-ai.client";
import {
  changeNoteExtraPassword,
  decryptNote,
  decryptNoteTitle,
  encryptNote,
  protectNote,
  removeNoteExtraPassword,
  unlockProtectedNoteKey,
} from "~/lib/notes.client";
import type {
  EncryptedNote,
  EncryptedNoteInput,
  EncryptedNoteSummary,
} from "~/lib/notes";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  type WorkspaceEditorMode,
} from "~/lib/workspace";

type NoteFilter = "all" | "favorites" | "archived";
type WindowMode = "preview" | "edit";
type SyncStatus = "idle" | "saving" | "saved" | "error";
type ThemePreference = "light" | "dark" | "system";

const VaultItemsPanel = lazy(() =>
  import("~/components/vault-items-panel").then((module) => ({
    default: module.VaultItemsPanel,
  })),
);

interface NoteWindow {
  key: number;
  encrypted: EncryptedNote | null;
  title: string;
  content: string;
  pinned: boolean;
  archived: boolean;
  contentKey: CryptoKey | null;
  mode: WindowMode;
  minimized: boolean;
  maximized: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  dirty: boolean;
  version: number;
  sync: SyncStatus;
}

type PasswordAction =
  | { mode: "open"; note: EncryptedNote }
  | { mode: "protect" | "change" | "remove"; windowKey: number };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function sortNotes(notes: EncryptedNoteSummary[]) {
  return [...notes].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

export function NotesDesktop({
  email,
  initialTheme,
}: {
  email: string;
  initialTheme: ThemePreference;
}) {
  const { loading, masterKey, unlocked } = useVault();
  const workspace = useWorkspace();
  const [notes, setNotes] = useState<EncryptedNoteSummary[]>([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [windows, setWindows] = useState<NoteWindow[]>([]);
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState("");
  const [passwordAction, setPasswordAction] = useState<PasswordAction | null>(null);
  const [working, setWorking] = useState(false);
  const [vaultItemsOpen, setVaultItemsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [searchParams, setSearchParams] = useSearchParams();
  const resumedAction = useRef(false);
  const windowsRef = useRef<NoteWindow[]>([]);
  const keyRef = useRef(0);
  const zRef = useRef(1);
  const savingRef = useRef(new Set<number>());

  const updateWindows = useCallback(
    (update: (current: NoteWindow[]) => NoteWindow[]) => {
      setWindows((current) => {
        const next = update(current);
        windowsRef.current = next;
        return next;
      });
    },
    [],
  );

  const updateWindow = useCallback(
    (key: number, update: (window: NoteWindow) => NoteWindow) => {
      updateWindows((current) =>
        current.map((window) => (window.key === key ? update(window) : window)),
      );
    },
    [updateWindows],
  );

  const loadNotes = useCallback(async () => {
    const result = await requestJson<{ notes: EncryptedNoteSummary[] }>("/api/notes");
    setNotes(result.notes);
    setNotesLoaded(true);
  }, []);

  useEffect(() => {
    loadNotes().catch(() => setError("Notes could not be loaded."));
  }, [loadNotes]);

  useEffect(() => {
    if (!masterKey) return;
    Promise.all(
      notes.map(async (note) => [
        note.id,
        note.isCritical
          ? "Critical note"
          : note.hasExtraPassword
            ? "Protected note"
            : await decryptNoteTitle(note, masterKey),
      ] as const),
    )
      .then((entries) => setTitles(Object.fromEntries(entries)))
      .catch(() => setError("Note titles could not be decrypted."));
  }, [masterKey, notes]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    if (resumedAction.current) return;
    const action = searchParams.get("action");
    const noteId = searchParams.get("noteId");
    if (!noteId || !["open-critical", "set-critical"].includes(action ?? "")) return;
    resumedAction.current = true;
    const value = searchParams.get("value") === "true";
    setSearchParams({}, { replace: true });
    if (action === "open-critical") void openNote(noteId);
    else void setCritical(noteId, value);
  }, [searchParams, setSearchParams]);

  async function changeTheme(nextTheme: ThemePreference) {
    const previous = theme;
    setTheme(nextTheme);
    try {
      await requestJson("/api/preferences/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: nextTheme }),
      });
    } catch {
      setTheme(previous);
      setError("The theme could not be saved.");
    }
  }

  const saveWindow = useCallback(
    async (key: number) => {
      const snapshot = windowsRef.current.find((window) => window.key === key);
      if (!snapshot?.dirty || !masterKey || savingRef.current.has(key)) return;
      const creating = !snapshot.encrypted;
      savingRef.current.add(key);
      updateWindow(key, (window) => ({ ...window, sync: "saving" }));
      try {
        const protection = snapshot.encrypted?.hasExtraPassword
          ? {
              extraPasswordSalt: snapshot.encrypted.extraPasswordSalt!,
              extraPasswordEncryptedNoteKey:
                snapshot.encrypted.extraPasswordEncryptedNoteKey!,
              extraPasswordNoteKeyIv: snapshot.encrypted.extraPasswordNoteKeyIv!,
            }
          : undefined;
        const input = await encryptNote(
          { title: snapshot.title, content: snapshot.content },
          snapshot.contentKey ?? masterKey,
          { pinned: snapshot.pinned, archived: snapshot.archived },
          protection,
        );
        const { note } = await requestJson<{ note: EncryptedNote }>(
          snapshot.encrypted ? `/api/notes/${snapshot.encrypted.id}` : "/api/notes",
          {
            method: snapshot.encrypted ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        setNotes((current) =>
          sortNotes([...current.filter((item) => item.id !== note.id), note]),
        );
        setTitles((current) => ({
          ...current,
          [note.id]: note.hasExtraPassword ? "Protected note" : snapshot.title || "Untitled",
        }));
        updateWindow(key, (current) => ({
          ...current,
          encrypted: note,
          dirty: current.version !== snapshot.version,
          sync: current.version === snapshot.version ? "saved" : "idle",
        }));
        workspace.openNote(note.id);
        toast.success(creating ? "Note created" : "Note saved", {
          id: `note-save-${note.id}`,
          duration: 1_800,
        });
      } catch {
        updateWindow(key, (window) => ({ ...window, sync: "error" }));
        setError("A note could not be synced.");
      } finally {
        savingRef.current.delete(key);
      }
    },
    [masterKey, updateWindow],
  );

  useEffect(() => {
    const dirty = windows.filter((window) => window.dirty).map((window) => window.key);
    if (!dirty.length) return;
    const timeout = window.setTimeout(
      () => dirty.forEach((key) => void saveWindow(key)),
      1_000,
    );
    return () => window.clearTimeout(timeout);
  }, [saveWindow, windows]);

  function windowGeometry() {
    const offset = (windowsRef.current.length % 6) * 28;
    return { x: 32 + offset, y: 28 + offset, width: 620, height: 560 };
  }

  function addWindow(
    note: EncryptedNote | null,
    plain: { title: string; content: string },
    contentKey: CryptoKey | null,
    mode: WindowMode,
  ) {
    const existing = note
      ? windowsRef.current.find((window) => window.encrypted?.id === note.id)
      : null;
    if (existing) {
      focusWindow(existing.key);
      return;
    }
    keyRef.current += 1;
    zRef.current += 1;
    const next: NoteWindow = {
      key: keyRef.current,
      encrypted: note,
      ...plain,
      pinned: note?.pinned ?? false,
      archived: note?.archived ?? false,
      contentKey,
      mode: note
        ? workspaceModeToWindowMode(workspace.noteUiState[note.id]?.editorMode)
        : mode,
      minimized: false,
      maximized: false,
      ...windowGeometry(),
      z: zRef.current,
      dirty: false,
      version: 0,
      sync: note ? "saved" : "idle",
    };
    updateWindows((current) => [...current, next]);
  }

  async function openNote(noteId: string, persist = true) {
    if (!masterKey) return;
    if (
      persist &&
      !workspace.openNoteIds.includes(noteId) &&
      workspace.openNoteIds.length >= 10
    ) {
      const oldestId = workspace.openNoteIds[0]!;
      const oldestWindow = windowsRef.current.find(
        (noteWindow) => noteWindow.encrypted?.id === oldestId,
      );
      if (oldestWindow) await closeWindow(oldestWindow.key);
      else workspace.closeNote(oldestId);
    }
    if (persist) workspace.openNote(noteId);
    const existing = windowsRef.current.find((window) => window.encrypted?.id === noteId);
    if (existing) return focusWindow(existing.key, persist);
    setError("");
    setWorking(true);
    try {
      const response = await fetch(`/api/notes/${noteId}`);
      const result = (await response.json()) as {
        note?: EncryptedNote;
        requiresRecent2FA?: boolean;
        confirmUrl?: string;
      };
      if (response.status === 428 && result.requiresRecent2FA) {
        window.location.assign(result.confirmUrl ?? "/auth/2fa/confirm");
        return;
      }
      if (!response.ok || !result.note) throw new Error("The note could not be opened.");
      const note = result.note;
      if (note.hasExtraPassword) {
        setPasswordAction({ mode: "open", note });
      } else {
        addWindow(note, await decryptNote(note, masterKey), null, "preview");
      }
      setSidebarOpen(false);
    } catch {
      setError("The note could not be opened.");
    } finally {
      setWorking(false);
    }
  }

  async function setCritical(noteId: string, isCritical: boolean) {
    setError("");
    setWorking(true);
    try {
      const response = await fetch(`/api/notes/${noteId}/critical`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCritical }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        note?: EncryptedNoteSummary;
        error?: string;
        requiresRecent2FA?: boolean;
        confirmUrl?: string;
      };
      if (response.status === 428 && result.requiresRecent2FA) {
        window.location.assign(result.confirmUrl ?? "/auth/2fa/confirm");
        return;
      }
      if (!response.ok || !result.note) {
        throw new Error(result.error ?? "The note could not be updated.");
      }
      const summary = result.note;
      setNotes((current) =>
        sortNotes([...current.filter((note) => note.id !== summary.id), summary]),
      );
      setTitles((current) => ({
        ...current,
        [summary.id]: summary.isCritical
          ? "Critical note"
          : windowsRef.current.find((window) => window.encrypted?.id === summary.id)
              ?.title ?? current[summary.id],
      }));
      updateWindows((current) =>
        current.map((noteWindow) =>
          noteWindow.encrypted?.id === summary.id
            ? {
                ...noteWindow,
                encrypted: { ...noteWindow.encrypted, ...summary },
              }
            : noteWindow,
        ),
      );
    } catch {
      setError("Critical mode could not be updated.");
    } finally {
      setWorking(false);
    }
  }

  function createNote() {
    addWindow(null, { title: "", content: "" }, null, "edit");
    setSidebarOpen(false);
  }

  function focusWindow(key: number, persist = true) {
    zRef.current += 1;
    const noteId = windowsRef.current.find((window) => window.key === key)?.encrypted?.id;
    if (persist && noteId) workspace.setActiveNote(noteId);
    updateWindow(key, (window) => ({
      ...window,
      z: zRef.current,
      minimized: false,
    }));
  }

  function changeWindow(key: number, values: Partial<Pick<NoteWindow, "title" | "content" | "pinned" | "archived">>) {
    updateWindow(key, (window) => ({
      ...window,
      ...values,
      dirty: true,
      version: window.version + 1,
      sync: "idle",
    }));
  }

  async function closeWindow(key: number) {
    await saveWindow(key);
    const noteId = windowsRef.current.find((window) => window.key === key)?.encrypted?.id;
    if (noteId) workspace.closeNote(noteId);
    updateWindows((current) => current.filter((window) => window.key !== key));
  }

  async function deleteWindowNote(key: number) {
    const target = windowsRef.current.find((window) => window.key === key);
    if (!target?.encrypted) return;
    setWorking(true);
    try {
      await requestJson(`/api/notes/${target.encrypted.id}`, { method: "DELETE" });
      setNotes((current) => current.filter((note) => note.id !== target.encrypted!.id));
      setTitles((current) => {
        const next = { ...current };
        delete next[target.encrypted!.id];
        return next;
      });
      updateWindows((current) => current.filter((window) => window.key !== key));
      workspace.closeNote(target.encrypted.id);
      toast.success("Note deleted");
    } catch {
      setError("The note could not be deleted.");
    } finally {
      setWorking(false);
    }
  }

  function confirmDeleteWindowNote(key: number) {
    const target = windowsRef.current.find((window) => window.key === key);
    if (!target?.encrypted) return;
    toast.warning("Permanently delete this note?", {
      id: `delete-note-${target.encrypted.id}`,
      description: "This action cannot be undone.",
      duration: Infinity,
      action: {
        label: "Delete",
        onClick: () => void deleteWindowNote(key),
      },
      cancel: {
        label: "Cancel",
        onClick: () => undefined,
      },
    });
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>, key: number) {
    if ((event.target as HTMLElement).closest("button") || window.innerWidth < 768) return;
    const target = windowsRef.current.find((window) => window.key === key);
    if (!target || target.maximized) return;
    focusWindow(key);
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = target.x;
    const startTop = target.y;
    const move = (moveEvent: PointerEvent) => {
      updateWindow(key, (window) => ({
        ...window,
        x: Math.max(0, startLeft + moveEvent.clientX - startX),
        y: Math.max(0, startTop + moveEvent.clientY - startY),
      }));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  }

  function beginSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = workspace.sidebarWidth;
    const move = (moveEvent: PointerEvent) => {
      workspace.setSidebarWidth(
        Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + moveEvent.clientX - startX),
        ),
      );
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      workspace.persistWorkspaceDebounced();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  }

  async function updateProtection(input: EncryptedNoteInput, contentKey: CryptoKey | null, key: number) {
    const target = windowsRef.current.find((window) => window.key === key);
    if (!target?.encrypted) return;
    const { note } = await requestJson<{ note: EncryptedNote }>(`/api/notes/${target.encrypted.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    setNotes((current) => sortNotes([...current.filter((item) => item.id !== note.id), note]));
    setTitles((current) => ({ ...current, [note.id]: note.hasExtraPassword ? "Protected note" : target.title || "Untitled" }));
    updateWindow(key, (window) => ({ ...window, encrypted: note, contentKey, dirty: false, sync: "saved" }));
  }

  async function handlePasswordAction(currentPassword: string, newPassword: string) {
    if (!passwordAction || !masterKey) return;
    setWorking(true);
    setError("");
    try {
      if (passwordAction.mode === "open") {
        const key = await unlockProtectedNoteKey(passwordAction.note, currentPassword);
        addWindow(passwordAction.note, await decryptNote(passwordAction.note, masterKey, key), key, "preview");
      } else {
        await saveWindow(passwordAction.windowKey);
        const target = windowsRef.current.find((window) => window.key === passwordAction.windowKey);
        if (!target?.encrypted) throw new Error("The note must be saved first.");
        if (passwordAction.mode === "protect") {
          const result = await protectNote({ title: target.title, content: target.content }, newPassword, target);
          await updateProtection(result.input, result.noteKey, target.key);
        } else if (passwordAction.mode === "change") {
          const result = await changeNoteExtraPassword(target.encrypted, currentPassword, newPassword);
          await updateProtection(result.input, result.noteKey, target.key);
        } else {
          await updateProtection(
            await removeNoteExtraPassword(target.encrypted, currentPassword, masterKey),
            null,
            target.key,
          );
        }
      }
      setPasswordAction(null);
    } catch {
      setError("The operation could not be completed. Check the password.");
    } finally {
      setWorking(false);
    }
  }

  const vaultReady = !loading && unlocked && Boolean(masterKey);
  const filteredNotes = notes.filter((note) => {
    if (filter === "favorites" && !note.pinned) return false;
    if (filter === "archived" && !note.archived) return false;
    if (filter !== "archived" && note.archived) return false;
    return !query.trim() || (titles[note.id] ?? "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });

  return (
    <>
      <WorkspaceRestoreHandler
        ready={vaultReady && notesLoaded && !workspace.loading}
        openNoteIds={workspace.openNoteIds}
        activeNoteId={workspace.activeNoteId}
        notes={notes}
        onOpen={(noteId) => openNote(noteId, false)}
        onActivate={(noteId) => {
          const active = windowsRef.current.find(
            (noteWindow) => noteWindow.encrypted?.id === noteId,
          );
          if (active) focusWindow(active.key, false);
        }}
      />
      <main className="flex h-dvh overflow-hidden bg-zinc-100 text-zinc-950 dark:bg-[#08090b] dark:text-zinc-100">
        {sidebarOpen ? <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} /> : null}
        <aside
          style={{
            width:
              workspace.sidebarCollapsed && !sidebarOpen
                ? 0
                : workspace.sidebarWidth,
          }}
          className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 flex h-dvh max-h-dvh w-72 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50 transition-[width,transform] lg:static lg:translate-x-0 dark:border-zinc-800 dark:bg-zinc-900`}
        >
          <div className="flex items-center gap-3 px-4 py-4">
            <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
            <div className="min-w-0"><p className="text-sm font-semibold">Notes</p><p className="truncate text-xs text-zinc-500">{email}</p></div>
          </div>
          <div className="space-y-2 px-2">
            <SidebarButton icon={<FiPlus />} label="New note" onClick={createNote} />
            <SidebarButton icon={<FiKey />} label="Personal Vault" onClick={() => setVaultItemsOpen(true)} />
            <label className="relative block">
              <FiSearch className="absolute top-2.5 left-2.5 text-zinc-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" className="w-full rounded-md bg-zinc-200/60 py-2 pr-3 pl-8 text-sm outline-none dark:bg-zinc-800" />
            </label>
          </div>
          <nav className="mt-4 space-y-1 px-2">
            <SidebarButton active={filter === "all"} icon={<FiFolder />} label="All" count={notes.filter((note) => !note.archived).length} onClick={() => setFilter("all")} />
            <SidebarButton active={filter === "favorites"} icon={<FiStar />} label="Favorites" count={notes.filter((note) => note.pinned && !note.archived).length} onClick={() => setFilter("favorites")} />
            <SidebarButton active={filter === "archived"} icon={<FiArchive />} label="Archived" count={notes.filter((note) => note.archived).length} onClick={() => setFilter("archived")} />
          </nav>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2">
            {filteredNotes.map((note) => (
              <button key={note.id} type="button" onClick={() => void openNote(note.id)} className="mb-0.5 block w-full rounded-md px-2.5 py-2 text-left hover:bg-zinc-200/70 dark:hover:bg-zinc-800">
                <span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{titles[note.id] ?? "Decrypting..."}</span>{note.pinned ? <FiStar className="shrink-0 fill-amber-400 text-amber-500" /> : null}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">{note.isCritical ? <CriticalBadge /> : null}{note.hasExtraPassword ? <FiLock aria-label="Protected" /> : null}{formatDate(note.updatedAt)}</span>
              </button>
            ))}
          </div>
          <div className="shrink-0 border-t border-zinc-200 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-zinc-800">
            <AccountMenu
              email={email}
              theme={theme}
              onTheme={(nextTheme) => void changeTheme(nextTheme)}
            />
          </div>
          <SidebarResizeHandle onPointerDown={beginSidebarResize} />
        </aside>

        <section className="workspace-background relative min-w-0 flex-1 overflow-hidden">
          <button
            type="button"
            title={workspace.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            onClick={() => workspace.setSidebarCollapsed(!workspace.sidebarCollapsed)}
            className="absolute top-2 left-2 z-20 hidden rounded-md border border-zinc-300 bg-white p-2 lg:block dark:border-zinc-700 dark:bg-zinc-900"
          >
            <FiSidebar />
          </button>
          <header className="absolute inset-x-0 top-0 z-20 flex h-12 items-center border-b border-zinc-200 bg-white/90 px-3 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-950/90">
            <button className="rounded-md p-2" onClick={() => setSidebarOpen(true)}><FiMenu /></button>
            <span className="ml-2 text-sm font-medium">Notes desktop</span>
          </header>
          {error ? <div className="absolute top-3 right-3 z-[1000] rounded-lg bg-red-600 px-4 py-2 text-sm text-white shadow-lg">{error}<button className="ml-3" onClick={() => setError("")}><FiX /></button></div> : null}
          {!windows.length ? (
            vaultReady ? (
              <DesktopEmpty onCreate={createNote} />
            ) : (
              <DesktopLoading />
            )
          ) : null}
          {windows.map((noteWindow) => (
            <NoteWindowView
              key={noteWindow.key}
              noteWindow={noteWindow}
              working={working}
              onFocus={() => focusWindow(noteWindow.key)}
              onDrag={(event) => beginDrag(event, noteWindow.key)}
              onChange={(values) => changeWindow(noteWindow.key, values)}
              onClose={() => void closeWindow(noteWindow.key)}
              onDelete={() => confirmDeleteWindowNote(noteWindow.key)}
              onMode={(mode) => {
                updateWindow(noteWindow.key, (window) => ({ ...window, mode }));
                if (noteWindow.encrypted) {
                  workspace.updateNoteUiState(noteWindow.encrypted.id, {
                    editorMode: mode,
                  });
                }
              }}
              onScroll={(scrollTop) => {
                if (noteWindow.encrypted) {
                  workspace.updateNoteUiState(noteWindow.encrypted.id, { scrollTop });
                }
              }}
              onMinimize={() => updateWindow(noteWindow.key, (window) => ({ ...window, minimized: !window.minimized }))}
              onMaximize={() => updateWindow(noteWindow.key, (window) => ({ ...window, maximized: !window.maximized, minimized: false }))}
              onResize={(width, height) => updateWindow(noteWindow.key, (window) => ({ ...window, width, height }))}
              onProtection={(mode) => setPasswordAction({ mode, windowKey: noteWindow.key })}
              onCritical={(isCritical) => noteWindow.encrypted && void setCritical(noteWindow.encrypted.id, isCritical)}
            />
          ))}
          <OpenNotesTabs
            activeNoteId={workspace.activeNoteId}
            openNoteIds={workspace.openNoteIds}
            titles={titles}
            onOpen={(noteId) => void openNote(noteId)}
            onClose={(noteId) => {
              const noteWindow = windowsRef.current.find(
                (item) => item.encrypted?.id === noteId,
              );
              if (noteWindow) void closeWindow(noteWindow.key);
              else workspace.closeNote(noteId);
            }}
          />
        </section>
      </main>
      {passwordAction ? <PasswordDialog action={passwordAction} working={working} onCancel={() => setPasswordAction(null)} onSubmit={handlePasswordAction} /> : null}
      {vaultItemsOpen ? (
        <Suspense fallback={null}>
          <VaultItemsPanel onClose={() => setVaultItemsOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}

function AccountMenu({
  email,
  theme,
  onTheme,
}: {
  email: string;
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      {open ? (
        <div className="absolute right-0 bottom-full left-0 mb-2 space-y-2 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setCustomizeOpen((current) => !current)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <FiSun />
            Customize
            {customizeOpen ? <FiChevronUp /> : <FiChevronDown />}
          </button>
          {customizeOpen ? (
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
              {(["light", "dark", "system"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  title={themeLabel(option)}
                  onClick={() => onTheme(option)}
                  className={`flex flex-col items-center gap-1 rounded-md px-2 py-2 text-[11px] ${
                    theme === option
                      ? "bg-white font-semibold shadow-sm dark:bg-zinc-700"
                      : "text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
                  }`}
                >
                  {option === "light" ? (
                    <FiSun />
                  ) : option === "dark" ? (
                    <FiMoon />
                  ) : (
                    <FiMonitor />
                  )}
                  {option === "light"
                    ? "Light"
                    : option === "dark"
                      ? "Dark"
                      : "System"}
                </button>
              ))}
            </div>
          ) : null}
          <Link
            to="/settings/security"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <FiShield />
            Security
          </Link>
          <LogoutButton />
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 rounded-lg border border-zinc-300 px-3 py-2 text-left hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          <FiUser />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">Account</span>
          <span className="block truncate text-[11px] text-zinc-500">
            {email}
          </span>
        </span>
        {open ? <FiChevronDown /> : <FiChevronUp />}
      </button>
    </div>
  );
}

function NoteWindowView({
  noteWindow,
  working,
  onFocus,
  onDrag,
  onChange,
  onClose,
  onDelete,
  onMode,
  onScroll,
  onMinimize,
  onMaximize,
  onResize,
  onProtection,
  onCritical,
}: {
  noteWindow: NoteWindow;
  working: boolean;
  onFocus: () => void;
  onDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onChange: (values: Partial<Pick<NoteWindow, "title" | "content" | "pinned" | "archived">>) => void;
  onClose: () => void;
  onDelete: () => void;
  onMode: (mode: WindowMode) => void;
  onScroll: (scrollTop: number) => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onResize: (width: number, height: number) => void;
  onProtection: (mode: "protect" | "change" | "remove") => void;
  onCritical: (isCritical: boolean) => void;
}) {
  const workspace = useWorkspace();
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiCapabilities, setAiCapabilities] =
    useState<LocalAICapabilities | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScrollTop = useRef(0);
  const restoredScrollKey = useRef("");

  useEffect(() => {
    const noteId = noteWindow.encrypted?.id;
    if (!noteId || !scrollRef.current) return;
    const restoreKey = `${noteId}:${noteWindow.mode}`;
    if (restoredScrollKey.current === restoreKey) return;
    restoredScrollKey.current = restoreKey;
    const scrollTop = workspace.noteUiState[noteId]?.scrollTop ?? 0;
    latestScrollTop.current = scrollTop;
    const frame = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
    });
    return () => cancelAnimationFrame(frame);
  }, [noteWindow.encrypted?.id, noteWindow.mode]);

  useEffect(
    () => () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    [],
  );

  useEffect(() => {
    void getLocalAICapabilities().then(setAiCapabilities);
  }, []);

  function handleScroll(scrollTop: number) {
    latestScrollTop.current = scrollTop;
    if (scrollTimer.current) return;
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = null;
      onScroll(latestScrollTop.current);
    }, 300);
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(noteWindow.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  function openLocalAI() {
    if (!aiCapabilities) {
      toast.info("Checking Local AI availability...");
      return;
    }
    if (!hasAnyLocalAI(aiCapabilities)) {
      toast.info("Local AI is unavailable in this browser or device.");
      return;
    }
    setAiOpen(true);
  }

  const style = noteWindow.maximized
    ? { inset: "0 0 44px 0", zIndex: noteWindow.z }
    : {
        left: noteWindow.x,
        top: noteWindow.y,
        width: noteWindow.width,
        height: noteWindow.minimized ? 42 : noteWindow.height,
        zIndex: noteWindow.z,
        resize: noteWindow.minimized ? "none" as const : "both" as const,
      };
  return (
    <article
      ref={articleRef}
      style={style}
      onPointerDown={onFocus}
      onPointerUp={(event) => {
        if (noteWindow.maximized || noteWindow.minimized) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (bounds.width !== noteWindow.width || bounds.height !== noteWindow.height) {
          onResize(Math.round(bounds.width), Math.round(bounds.height));
        }
      }}
      className="absolute flex max-h-[calc(100%-44px)] min-h-10 min-w-80 flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl max-md:inset-x-2! max-md:top-14! max-md:w-auto! dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div onPointerDown={onDrag} onDoubleClick={onMaximize} className="flex h-10 shrink-0 cursor-move items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-2 dark:border-zinc-700 dark:bg-zinc-800">
        <FiFileText className="shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {noteWindow.mode === "edit" ? "Editing note" : noteWindow.title || "Untitled"}
        </span>
        <SyncDot status={noteWindow.sync} />
        <WindowButton label="Minimize" onClick={onMinimize}><FiMinus /></WindowButton>
        <WindowButton label={noteWindow.maximized ? "Restore" : "Maximize"} onClick={onMaximize}>{noteWindow.maximized ? <FiMinimize2 /> : <FiMaximize2 />}</WindowButton>
        <WindowButton label="Close" onClick={onClose}><FiX /></WindowButton>
      </div>
      {!noteWindow.minimized ? (
        <>
          {noteWindow.mode === "edit" ? (
            <div className="flex h-12 shrink-0 items-center border-b border-zinc-200 px-3 sm:pr-64 dark:border-zinc-800">
              <input value={noteWindow.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="Untitled" className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none" />
            </div>
          ) : null}
          {noteWindow.mode === "preview" && noteWindow.encrypted?.isCritical ? (
            <div className="absolute top-14 left-3 z-[1040]">
              <CriticalBadge />
            </div>
          ) : null}
          <div className="absolute top-12 right-3 z-[1050] flex items-center gap-2 rounded-lg border border-zinc-200 bg-white/90 p-1.5 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
            <button type="button" onClick={() => onMode(noteWindow.mode === "preview" ? "edit" : "preview")} className="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"><FiEdit3 />{noteWindow.mode === "preview" ? "Edit" : "Preview"}</button>
            <button
              type="button"
              aria-label="Copy Markdown content"
              title="Copy Markdown content"
              onClick={() => void copyMarkdown()}
              className="flex items-center gap-2 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {copied ? <FiCheck className="text-emerald-500" /> : <FiCopy />}
              <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
            </button>
            <div className="relative">
              <button aria-label="More options" onClick={() => setMenu((current) => !current)} className="rounded-md border border-zinc-300 p-2 dark:border-zinc-700"><FiMoreHorizontal /></button>
              {menu ? <NoteMenu noteWindow={noteWindow} working={working} onAI={openLocalAI} onChange={onChange} onDelete={onDelete} onProtection={onProtection} onCritical={onCritical} onClose={() => setMenu(false)} /> : null}
            </div>
          </div>
          <div
            ref={scrollRef}
            onScroll={(event) => handleScroll(event.currentTarget.scrollTop)}
            className="min-h-0 flex-1 overflow-auto"
          >
            {noteWindow.mode === "edit" ? (
              <div data-color-mode={document.documentElement.classList.contains("dark") ? "dark" : "light"} className="h-full">
                <MDEditor value={noteWindow.content} onChange={(value) => onChange({ content: value ?? "" })} preview="edit" height="100%" visibleDragbar={false} textareaProps={{ placeholder: "Write in Markdown..." }} className="!rounded-none !border-0 !shadow-none" />
              </div>
            ) : (
              <div className="min-h-full bg-white px-6 pt-16 pb-6 dark:bg-[#0d1117]">
                <MDEditor.Markdown source={noteWindow.content || "*This note has no content.*"} rehypePlugins={[[rehypeSanitize]]} />
              </div>
            )}
          </div>
        </>
      ) : null}
      {aiOpen && aiCapabilities ? (
        <LocalAIPanel
          capabilities={aiCapabilities}
          content={noteWindow.content}
          getSelection={() => {
            const textarea = articleRef.current?.querySelector("textarea");
            if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
              return null;
            }
            return {
              start: textarea.selectionStart,
              end: textarea.selectionEnd,
              text: textarea.value.slice(
                textarea.selectionStart,
                textarea.selectionEnd,
              ),
            };
          }}
          onClose={() => setAiOpen(false)}
          onInsert={(text) =>
            onChange({
              content: noteWindow.content
                ? `${noteWindow.content}\n\n${text}`
                : text,
            })
          }
          onReplaceSelection={(selection, text) =>
            onChange({
              content:
                noteWindow.content.slice(0, selection.start) +
                text +
                noteWindow.content.slice(selection.end),
            })
          }
          onUseTitle={(title) => onChange({ title })}
        />
      ) : null}
    </article>
  );
}

function NoteMenu({ noteWindow, working, onAI, onChange, onDelete, onProtection, onCritical, onClose }: {
  noteWindow: NoteWindow;
  working: boolean;
  onAI: () => void;
  onChange: (values: Partial<Pick<NoteWindow, "pinned" | "archived">>) => void;
  onDelete: () => void;
  onProtection: (mode: "protect" | "change" | "remove") => void;
  onCritical: (isCritical: boolean) => void;
  onClose: () => void;
}) {
  const action = (run: () => void) => { run(); onClose(); };
  return (
    <div className="absolute top-11 right-0 z-[1100] max-h-[70dvh] w-60 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <MenuLabel>Note</MenuLabel>
      <MenuButton icon={<FiStar />} label={noteWindow.pinned ? "Unpin" : "Pin"} onClick={() => action(() => onChange({ pinned: !noteWindow.pinned }))} />
      <MenuButton icon={<FiArchive />} label={noteWindow.archived ? "Unarchive" : "Archive"} onClick={() => action(() => onChange({ archived: !noteWindow.archived }))} />
      <MenuDivider />
      <MenuLabel>Intelligence</MenuLabel>
      <MenuButton icon={<FiCpu />} label="Local AI" onClick={() => action(onAI)} />
      {noteWindow.encrypted ? (
        <>
          <MenuDivider />
          <MenuLabel>Security</MenuLabel>
          <MenuButton icon={<FiAlertTriangle />} label={noteWindow.encrypted.isCritical ? "Remove critical mode" : "Mark as critical"} disabled={working} onClick={() => action(() => onCritical(!noteWindow.encrypted!.isCritical))} />
          {noteWindow.encrypted.hasExtraPassword ? (
            <>
              <MenuButton icon={<FiKey />} label="Change password" disabled={working} onClick={() => action(() => onProtection("change"))} />
              <MenuButton icon={<FiUnlock />} label="Remove protection" disabled={working} onClick={() => action(() => onProtection("remove"))} />
            </>
          ) : <MenuButton icon={<FiShield />} label="Protect note" disabled={working} onClick={() => action(() => onProtection("protect"))} />}
        </>
      ) : null}
      {noteWindow.encrypted ? (
        <>
          <MenuDivider />
          <MenuLabel>Danger zone</MenuLabel>
          <MenuButton danger icon={<FiTrash2 />} label="Delete" disabled={working} onClick={() => action(onDelete)} />
        </>
      ) : null}
    </div>
  );
}

type TextSelection = { start: number; end: number; text: string };
type LocalAIAction =
  | "summarize"
  | "translate"
  | "detect"
  | "title"
  | "tasks"
  | "rewrite";

function LocalAIPanel({
  capabilities,
  content,
  getSelection,
  onClose,
  onInsert,
  onReplaceSelection,
  onUseTitle,
}: {
  capabilities: LocalAICapabilities;
  content: string;
  getSelection: () => TextSelection | null;
  onClose: () => void;
  onInsert: (text: string) => void;
  onReplaceSelection: (selection: TextSelection, text: string) => void;
  onUseTitle: (title: string) => void;
}) {
  const [action, setAction] = useState<LocalAIAction | null>(null);
  const [status, setStatus] = useState<LocalAIAvailability | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("es");
  const [instruction, setInstruction] = useState("Improve clarity and keep the original meaning.");
  const selectionRef = useRef<TextSelection | null>(null);

  const generativeAvailable = isAvailable(capabilities.writer) ||
    isAvailable(capabilities.languageModel);
  const rewriteAvailable = isAvailable(capabilities.rewriter) || generativeAvailable;

  async function run(nextAction: LocalAIAction) {
    setAction(nextAction);
    setResult("");
    setError("");
    setStatus(null);
    const onStatus = (nextStatus: LocalAIAvailability) => setStatus(nextStatus);
    try {
      if (!content.trim()) throw new Error("The note is empty.");
      if (nextAction === "summarize") {
        setResult(await summarizeText(content, { onStatus }));
      } else if (nextAction === "translate") {
        let sourceLanguage = "en";
        if (isAvailable(capabilities.languageDetector)) {
          const languages = await detectLanguage(content, { onStatus });
          sourceLanguage = languages[0]?.detectedLanguage ?? sourceLanguage;
        }
        setResult(
          await translateText(content, sourceLanguage, targetLanguage, { onStatus }),
        );
      } else if (nextAction === "detect") {
        const languages = await detectLanguage(content, { onStatus });
        setResult(
          languages.length
            ? languages
                .slice(0, 3)
                .map(
                  (language) =>
                    `${language.detectedLanguage}: ${Math.round(language.confidence * 100)}%`,
                )
                .join("\n")
            : "No language detected.",
        );
      } else if (nextAction === "title") {
        setResult(await suggestTitle(content, { onStatus }));
      } else if (nextAction === "tasks") {
        setResult(await extractTasks(content, { onStatus }));
      } else {
        const selection = getSelection();
        if (!selection) throw new Error("Select text in the Markdown editor first.");
        selectionRef.current = selection;
        setResult(await rewriteText(selection.text, instruction, { onStatus }));
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === "The note is empty."
          ? cause.message
          : cause instanceof Error &&
              cause.message === "Select text in the Markdown editor first."
            ? cause.message
            : "This local AI action is unavailable or could not be completed.",
      );
    } finally {
      setStatus(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[3000] grid place-items-center bg-black/60 p-4">
      <section className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <FiCpu /> Local AI
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              These actions run locally in your browser when Chrome allows it.
            </p>
          </div>
          <button type="button" aria-label="Close local AI" onClick={onClose} className="rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <FiX />
          </button>
        </header>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {isAvailable(capabilities.summarizer) ? <AIActionButton label="Summarize note" onClick={() => void run("summarize")} /> : null}
            {isAvailable(capabilities.languageDetector) ? <AIActionButton label="Detect language" onClick={() => void run("detect")} /> : null}
            {generativeAvailable ? <AIActionButton label="Suggest title" onClick={() => void run("title")} /> : null}
            {generativeAvailable ? <AIActionButton label="Extract actionable tasks" onClick={() => void run("tasks")} /> : null}
            {isAvailable(capabilities.translator) ? (
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <p className="text-sm font-semibold">Translate note</p>
              <p className="mt-1 text-xs text-zinc-500">
                Source language is detected automatically when supported.
              </p>
              <LanguageInput label="Translate to" value={targetLanguage} onChange={setTargetLanguage} />
              <AIActionButton className="mt-2" label="Translate" onClick={() => void run("translate")} />
            </div>
            ) : null}
            {rewriteAvailable ? (
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <p className="text-sm font-semibold">Rewrite selection</p>
              <input
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                className="mt-2 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-xs dark:border-zinc-700"
              />
              <AIActionButton className="mt-2" label="Rewrite selected text" onClick={() => void run("rewrite")} />
            </div>
            ) : null}
        </div>

        {status === "downloadable" || status === "downloading" ? (
          <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            Preparing local AI...
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}
        {result ? (
          <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm">{result}</pre>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {action === "title" ? (
                <button type="button" onClick={() => { onUseTitle(result); onClose(); }} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
                  Use title
                </button>
              ) : action === "rewrite" && selectionRef.current ? (
                <button type="button" onClick={() => { onReplaceSelection(selectionRef.current!, result); onClose(); }} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
                  Replace selection
                </button>
              ) : action !== "detect" ? (
                <button type="button" onClick={() => { onInsert(result); onClose(); }} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
                  Insert into note
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function AIActionButton({
  label,
  onClick,
  className = "",
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`rounded-lg border border-zinc-300 px-3 py-2 text-left text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 ${className}`}
    >
      {label}
    </button>
  );
}

function LanguageInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0 flex-1 text-[11px] text-zinc-500">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="en"
        className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm text-zinc-950 dark:border-zinc-700 dark:text-zinc-100"
      />
    </label>
  );
}

function isAvailable(value: LocalAIAvailability | undefined) {
  return Boolean(value && value !== "unavailable");
}

function hasAnyLocalAI(capabilities: LocalAICapabilities | null) {
  return Boolean(capabilities && Object.values(capabilities).some(isAvailable));
}

function PasswordDialog({ action, working, onCancel, onSubmit }: {
  action: PasswordAction;
  working: boolean;
  onCancel: () => void;
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const needsNew = action.mode === "protect" || action.mode === "change";
  const needsCurrent = action.mode !== "protect";
  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/60 p-4">
      <form autoComplete="off" data-form-type="other" onSubmit={(event) => { event.preventDefault(); if (!needsNew || next === confirmation) void onSubmit(current, next); }} className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">{action.mode === "open" ? "Open protected note" : action.mode === "protect" ? "Protect note" : action.mode === "change" ? "Change password" : "Remove protection"}</h2>
        <p className="text-sm text-zinc-500">This password is never sent to the server and cannot be recovered.</p>
        {needsCurrent ? <PasswordInput name="note-unlock-secret" label="Current password" value={current} onChange={setCurrent} /> : null}
        {needsNew ? <><PasswordInput name="note-new-secret" label="New password" value={next} onChange={setNext} /><PasswordInput name="note-new-secret-confirmation" label="Confirm password" value={confirmation} onChange={setConfirmation} /></> : null}
        <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancel</button><button disabled={working || (needsCurrent && !current) || (needsNew && (!next || next !== confirmation))} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Continue</button></div>
      </form>
    </div>
  );
}

function PasswordInput({ name, label, value, onChange }: { name: string; label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium">{label}<input required name={name} type="password" autoComplete="new-password" data-1p-ignore data-lpignore="true" data-form-type="other" value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>;
}

function SidebarButton({ active, icon, label, count, onClick }: { active?: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm ${active ? "bg-zinc-200 font-medium dark:bg-zinc-800" : "hover:bg-zinc-200/70 dark:hover:bg-zinc-800"}`}><span className="text-zinc-400">{icon}</span><span className="flex-1 text-left">{label}</span>{count !== undefined ? <span className="text-xs text-zinc-400">{count}</span> : null}</button>;
}

function OpenNotesTabs({
  openNoteIds,
  activeNoteId,
  titles,
  onOpen,
  onClose,
}: {
  openNoteIds: string[];
  activeNoteId: string | null;
  titles: Record<string, string>;
  onOpen: (noteId: string) => void;
  onClose: (noteId: string) => void;
}) {
  if (!openNoteIds.length) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex min-h-11 gap-1 overflow-x-auto border-t border-zinc-200 bg-white/90 p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      {openNoteIds.map((noteId) => (
        <button
          key={noteId}
          type="button"
          onClick={() => onOpen(noteId)}
          className={`flex max-w-56 shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs ${
            activeNoteId === noteId
              ? "bg-zinc-200 dark:bg-zinc-800"
              : "hover:bg-zinc-200 dark:hover:bg-zinc-800"
          }`}
        >
          <FiFileText />
          <span className="min-w-0 flex-1 truncate">
            {titles[noteId] ?? "Loading..."}
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Close note"
            onClick={(event) => {
              event.stopPropagation();
              onClose(noteId);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onClose(noteId);
              }
            }}
            className="rounded p-0.5 hover:bg-zinc-300 dark:hover:bg-zinc-700"
          >
            <FiX />
          </span>
        </button>
      ))}
    </div>
  );
}

function WorkspaceRestoreHandler({
  ready,
  openNoteIds,
  activeNoteId,
  notes,
  onOpen,
  onActivate,
}: {
  ready: boolean;
  openNoteIds: string[];
  activeNoteId: string | null;
  notes: EncryptedNoteSummary[];
  onOpen: (noteId: string) => Promise<void>;
  onActivate: (noteId: string) => void;
}) {
  const restored = useRef(false);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const restorableIds = openNoteIds.filter((noteId) => {
      const note = notes.find((item) => item.id === noteId);
      return note && !note.hasExtraPassword && !note.isCritical;
    });
    void Promise.all(restorableIds.map(onOpen)).then(() => {
      if (activeNoteId) onActivate(activeNoteId);
    });
  }, [activeNoteId, notes, onActivate, onOpen, openNoteIds, ready]);
  return null;
}

function SidebarResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="absolute inset-y-0 right-0 hidden w-1 cursor-col-resize hover:bg-blue-500/40 lg:block"
    />
  );
}

function WindowButton({ label, children, onClick }: { label: string; children: ReactNode; onClick: () => void }) {
  return <button type="button" aria-label={label} title={label} onPointerDown={(event) => event.stopPropagation()} onClick={onClick} className="rounded p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700">{children}</button>;
}

function MenuButton({ icon, label, danger, disabled, onClick }: { icon: ReactNode; label: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800 ${danger ? "text-red-600 dark:text-red-400" : ""}`}>{icon}{label}</button>;
}

function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{children}</p>;
}

function MenuDivider() {
  return <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />;
}

function SyncDot({ status }: { status: SyncStatus }) {
  const colors = { idle: "bg-amber-500", saving: "bg-blue-500 animate-pulse", saved: "bg-emerald-500", error: "bg-red-500" };
  return <span title={status} className={`h-2 w-2 shrink-0 rounded-full ${colors[status]}`} />;
}

function CriticalBadge() {
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"><FiAlertTriangle />Critical</span>;
}

function DesktopEmpty({ onCreate }: { onCreate: () => void }) {
  return <div className="grid h-full place-items-center pb-11 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-zinc-200 text-xl dark:bg-zinc-900"><FiFileText /></div><h2 className="mt-4 text-lg font-semibold">Your notes workspace</h2><p className="mt-1 text-sm text-zinc-500">Open multiple notes and arrange them as windows.</p><button onClick={onCreate} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"><FiPlus /> New note</button></div></div>;
}

function DesktopLoading() {
  return (
    <div className="grid h-full place-items-center pb-11 text-center">
      <div>
        <div className="mx-auto h-12 w-12 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-900" />
        <p className="mt-4 text-sm text-zinc-500">Loading encrypted vault...</p>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function themeLabel(theme: ThemePreference) {
  return theme === "light"
    ? "Light theme"
    : theme === "dark"
      ? "Dark theme"
      : "Use system theme";
}

function workspaceModeToWindowMode(
  mode: WorkspaceEditorMode | undefined,
): WindowMode {
  return mode === "edit" ? "edit" : "preview";
}
