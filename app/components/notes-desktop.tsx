import "@uiw/react-md-editor/markdown-editor.css";

import MDEditor from "@uiw/react-md-editor/nohighlight";
import rehypeSanitize from "rehype-sanitize";
import {
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
  FiShield,
  FiStar,
  FiSun,
  FiTrash2,
  FiUnlock,
  FiUser,
  FiX,
} from "react-icons/fi";
import { Link, useSearchParams } from "react-router";

import { LogoutButton } from "~/components/logout-button";
import { useVault } from "~/contexts/vault-context";
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

type NoteFilter = "all" | "favorites" | "archived";
type WindowMode = "preview" | "edit";
type SyncStatus = "idle" | "saving" | "saved" | "error";
type ThemePreference = "light" | "dark" | "system";

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
  const [notes, setNotes] = useState<EncryptedNoteSummary[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [windows, setWindows] = useState<NoteWindow[]>([]);
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState("");
  const [passwordAction, setPasswordAction] = useState<PasswordAction | null>(null);
  const [working, setWorking] = useState(false);
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
      mode,
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

  async function openNote(noteId: string) {
    if (!masterKey) return;
    const existing = windowsRef.current.find((window) => window.encrypted?.id === noteId);
    if (existing) return focusWindow(existing.key);
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

  function focusWindow(key: number) {
    zRef.current += 1;
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
    updateWindows((current) => current.filter((window) => window.key !== key));
  }

  async function deleteWindowNote(key: number) {
    const target = windowsRef.current.find((window) => window.key === key);
    if (!target?.encrypted || !window.confirm("Permanently delete this note?")) return;
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
    } catch {
      setError("The note could not be deleted.");
    } finally {
      setWorking(false);
    }
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

  if (loading || !unlocked) return <FullMessage>Loading encrypted vault...</FullMessage>;

  const filteredNotes = notes.filter((note) => {
    if (filter === "favorites" && !note.pinned) return false;
    if (filter === "archived" && !note.archived) return false;
    if (filter !== "archived" && note.archived) return false;
    return !query.trim() || (titles[note.id] ?? "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });

  return (
    <>
      <main className="flex h-dvh overflow-hidden bg-zinc-100 text-zinc-950 dark:bg-[#08090b] dark:text-zinc-100">
        {sidebarOpen ? <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} /> : null}
        <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 flex h-dvh max-h-dvh w-72 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50 transition-transform lg:static lg:translate-x-0 dark:border-zinc-800 dark:bg-zinc-900`}>
          <div className="flex items-center gap-3 px-4 py-4">
            <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
            <div className="min-w-0"><p className="text-sm font-semibold">Notes</p><p className="truncate text-xs text-zinc-500">{email}</p></div>
          </div>
          <div className="space-y-2 px-2">
            <SidebarButton icon={<FiPlus />} label="New note" onClick={createNote} />
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
        </aside>

        <section className="relative min-w-0 flex-1 overflow-hidden">
          <header className="absolute inset-x-0 top-0 z-20 flex h-12 items-center border-b border-zinc-200 bg-white/90 px-3 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-950/90">
            <button className="rounded-md p-2" onClick={() => setSidebarOpen(true)}><FiMenu /></button>
            <span className="ml-2 text-sm font-medium">Notes desktop</span>
          </header>
          {error ? <div className="absolute top-3 right-3 z-[1000] rounded-lg bg-red-600 px-4 py-2 text-sm text-white shadow-lg">{error}<button className="ml-3" onClick={() => setError("")}><FiX /></button></div> : null}
          {!windows.length ? <DesktopEmpty onCreate={createNote} /> : null}
          {windows.map((noteWindow) => (
            <NoteWindowView
              key={noteWindow.key}
              noteWindow={noteWindow}
              working={working}
              onFocus={() => focusWindow(noteWindow.key)}
              onDrag={(event) => beginDrag(event, noteWindow.key)}
              onChange={(values) => changeWindow(noteWindow.key, values)}
              onClose={() => void closeWindow(noteWindow.key)}
              onDelete={() => void deleteWindowNote(noteWindow.key)}
              onMode={(mode) => updateWindow(noteWindow.key, (window) => ({ ...window, mode }))}
              onMinimize={() => updateWindow(noteWindow.key, (window) => ({ ...window, minimized: !window.minimized }))}
              onMaximize={() => updateWindow(noteWindow.key, (window) => ({ ...window, maximized: !window.maximized, minimized: false }))}
              onResize={(width, height) => updateWindow(noteWindow.key, (window) => ({ ...window, width, height }))}
              onProtection={(mode) => setPasswordAction({ mode, windowKey: noteWindow.key })}
              onCritical={(isCritical) => noteWindow.encrypted && void setCritical(noteWindow.encrypted.id, isCritical)}
            />
          ))}
          {windows.length ? (
            <div className="absolute inset-x-0 bottom-0 z-20 flex min-h-11 gap-1 overflow-x-auto border-t border-zinc-200 bg-white/90 p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
              {windows.map((noteWindow) => (
                <button key={noteWindow.key} onClick={() => focusWindow(noteWindow.key)} className={`flex max-w-52 shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs ${noteWindow.minimized ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}>
                  <FiFileText /><span className="truncate">{noteWindow.title || "Untitled"}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </main>
      {passwordAction ? <PasswordDialog action={passwordAction} working={working} onCancel={() => setPasswordAction(null)} onSubmit={handlePasswordAction} /> : null}
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
  onMinimize: () => void;
  onMaximize: () => void;
  onResize: (width: number, height: number) => void;
  onProtection: (mode: "protect" | "change" | "remove") => void;
  onCritical: (isCritical: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(noteWindow.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
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
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{noteWindow.title || "Untitled"}</span>
        <SyncDot status={noteWindow.sync} />
        <WindowButton label="Minimize" onClick={onMinimize}><FiMinus /></WindowButton>
        <WindowButton label={noteWindow.maximized ? "Restore" : "Maximize"} onClick={onMaximize}>{noteWindow.maximized ? <FiMinimize2 /> : <FiMaximize2 />}</WindowButton>
        <WindowButton label="Close" onClick={onClose}><FiX /></WindowButton>
      </div>
      {!noteWindow.minimized ? (
        <>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
            {noteWindow.mode === "edit" ? (
              <input value={noteWindow.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="Untitled" className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none" />
            ) : <h2 className="flex min-w-0 flex-1 items-center gap-2 truncate font-semibold">{noteWindow.encrypted?.isCritical ? <CriticalBadge /> : null}<span className="truncate">{noteWindow.title || "Untitled"}</span></h2>}
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
              {menu ? <NoteMenu noteWindow={noteWindow} working={working} onChange={onChange} onDelete={onDelete} onProtection={onProtection} onCritical={onCritical} onClose={() => setMenu(false)} /> : null}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {noteWindow.mode === "edit" ? (
              <div data-color-mode={document.documentElement.classList.contains("dark") ? "dark" : "light"} className="h-full">
                <MDEditor value={noteWindow.content} onChange={(value) => onChange({ content: value ?? "" })} preview="edit" height="100%" visibleDragbar={false} textareaProps={{ placeholder: "Write in Markdown..." }} className="!rounded-none !border-0 !shadow-none" />
              </div>
            ) : (
              <div className="min-h-full bg-white p-6 dark:bg-[#0d1117]">
                <MDEditor.Markdown source={noteWindow.content || "*This note has no content.*"} rehypePlugins={[[rehypeSanitize]]} />
              </div>
            )}
          </div>
        </>
      ) : null}
    </article>
  );
}

function NoteMenu({ noteWindow, working, onChange, onDelete, onProtection, onCritical, onClose }: {
  noteWindow: NoteWindow;
  working: boolean;
  onChange: (values: Partial<Pick<NoteWindow, "pinned" | "archived">>) => void;
  onDelete: () => void;
  onProtection: (mode: "protect" | "change" | "remove") => void;
  onCritical: (isCritical: boolean) => void;
  onClose: () => void;
}) {
  const action = (run: () => void) => { run(); onClose(); };
  return (
    <div className="absolute top-11 right-0 z-[1100] w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <MenuButton icon={<FiStar />} label={noteWindow.pinned ? "Unpin" : "Pin"} onClick={() => action(() => onChange({ pinned: !noteWindow.pinned }))} />
      <MenuButton icon={<FiArchive />} label={noteWindow.archived ? "Unarchive" : "Archive"} onClick={() => action(() => onChange({ archived: !noteWindow.archived }))} />
      {noteWindow.encrypted ? <MenuButton icon={<FiAlertTriangle />} label={noteWindow.encrypted.isCritical ? "Remove critical mode" : "Mark as critical"} disabled={working} onClick={() => action(() => onCritical(!noteWindow.encrypted!.isCritical))} /> : null}
      {noteWindow.encrypted ? noteWindow.encrypted.hasExtraPassword ? (
        <>
          <MenuButton icon={<FiKey />} label="Change password" disabled={working} onClick={() => action(() => onProtection("change"))} />
          <MenuButton icon={<FiUnlock />} label="Remove protection" disabled={working} onClick={() => action(() => onProtection("remove"))} />
        </>
      ) : <MenuButton icon={<FiShield />} label="Protect note" disabled={working} onClick={() => action(() => onProtection("protect"))} /> : null}
      {noteWindow.encrypted ? <MenuButton danger icon={<FiTrash2 />} label="Delete" disabled={working} onClick={() => action(onDelete)} /> : null}
    </div>
  );
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
      <form onSubmit={(event) => { event.preventDefault(); if (!needsNew || next === confirmation) void onSubmit(current, next); }} className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">{action.mode === "open" ? "Open protected note" : action.mode === "protect" ? "Protect note" : action.mode === "change" ? "Change password" : "Remove protection"}</h2>
        <p className="text-sm text-zinc-500">This password is never sent to the server and cannot be recovered.</p>
        {needsCurrent ? <PasswordInput label="Current password" value={current} onChange={setCurrent} /> : null}
        {needsNew ? <><PasswordInput label="New password" value={next} onChange={setNext} /><PasswordInput label="Confirm password" value={confirmation} onChange={setConfirmation} /></> : null}
        <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancel</button><button disabled={working || (needsCurrent && !current) || (needsNew && (!next || next !== confirmation))} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Continue</button></div>
      </form>
    </div>
  );
}

function PasswordInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium">{label}<input required type="password" value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>;
}

function SidebarButton({ active, icon, label, count, onClick }: { active?: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm ${active ? "bg-zinc-200 font-medium dark:bg-zinc-800" : "hover:bg-zinc-200/70 dark:hover:bg-zinc-800"}`}><span className="text-zinc-400">{icon}</span><span className="flex-1 text-left">{label}</span>{count !== undefined ? <span className="text-xs text-zinc-400">{count}</span> : null}</button>;
}

function WindowButton({ label, children, onClick }: { label: string; children: ReactNode; onClick: () => void }) {
  return <button type="button" aria-label={label} title={label} onPointerDown={(event) => event.stopPropagation()} onClick={onClick} className="rounded p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700">{children}</button>;
}

function MenuButton({ icon, label, danger, disabled, onClick }: { icon: ReactNode; label: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800 ${danger ? "text-red-600 dark:text-red-400" : ""}`}>{icon}{label}</button>;
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

function FullMessage({ children }: { children: ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-100"><p>{children}</p></main>;
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
