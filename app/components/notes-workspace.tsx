import "@uiw/react-md-editor/markdown-editor.css";

import MDEditor from "@uiw/react-md-editor/nohighlight";
import rehypeSanitize from "rehype-sanitize";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import {
  FiArchive,
  FiCommand,
  FiFileText,
  FiFolder,
  FiKey,
  FiLock,
  FiMenu,
  FiMonitor,
  FiMoon,
  FiPlus,
  FiSave,
  FiSearch,
  FiShield,
  FiStar,
  FiSun,
  FiTrash2,
  FiUnlock,
  FiX,
} from "react-icons/fi";
import { Link } from "react-router";

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

const autosaveDelayMs = 1_000;

type SyncStatus = "idle" | "saving" | "saved" | "error";
type NoteFilter = "all" | "favorites" | "archived";
type ThemePreference = "light" | "dark" | "system";

interface EditorState {
  encrypted: EncryptedNote | null;
  title: string;
  content: string;
  pinned: boolean;
  archived: boolean;
  dirty: boolean;
  session: number;
  version: number;
  contentKey: CryptoKey | null;
}

interface SearchIndexEntry {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

interface SearchResult extends SearchIndexEntry {
  snippet: string;
}

type PasswordAction =
  | { mode: "open"; note: EncryptedNote }
  | { mode: "protect" | "change" | "remove" };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

function sortNotes(notes: EncryptedNoteSummary[]) {
  return [...notes].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

function normalizeSearchText(value: string) {
  return value.toLocaleLowerCase();
}

function createSearchSnippet(content: string, query: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "Sin contenido";
  if (!query) return compact.slice(0, 100);
  const index = normalizeSearchText(compact).indexOf(normalizeSearchText(query));
  if (index < 0) return compact.slice(0, 100);
  const start = Math.max(0, index - 38);
  const end = Math.min(compact.length, index + query.length + 62);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function searchMemoryIndex(
  index: Record<string, SearchIndexEntry>,
  query: string,
) {
  const normalized = normalizeSearchText(query.trim());
  if (!normalized) return [];

  return Object.values(index)
    .filter((entry) =>
      normalizeSearchText(`${entry.title}\n${entry.content}`).includes(normalized),
    )
    .sort((left, right) => {
      const leftTitle = normalizeSearchText(left.title).includes(normalized);
      const rightTitle = normalizeSearchText(right.title).includes(normalized);
      return Number(rightTitle) - Number(leftTitle);
    })
    .map((entry) => ({
      ...entry,
      snippet: createSearchSnippet(entry.content, query.trim()),
    }));
}

export function NotesWorkspace({ email }: { email: string }) {
  const { loading, masterKey, unlocked } = useVault();
  const [notes, setNotes] = useState<EncryptedNoteSummary[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [mobilePane, setMobilePane] = useState<"edit" | "preview">("edit");
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState<Record<string, SearchIndexEntry>>(
    {},
  );
  const [indexing, setIndexing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const [passwordAction, setPasswordAction] = useState<PasswordAction | null>(
    null,
  );
  const editorRef = useRef<EditorState | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const saveInFlightRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const sessionRef = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchIndexRef = useRef<Record<string, SearchIndexEntry>>({});

  const updateSearchIndex = useCallback((entry: SearchIndexEntry) => {
    setSearchIndex((current) => {
      const next = { ...current, [entry.id]: entry };
      searchIndexRef.current = next;
      return next;
    });
  }, []);

  const removeFromSearchIndex = useCallback((noteId: string) => {
    setSearchIndex((current) => {
      if (!current[noteId]) return current;
      const next = { ...current };
      delete next[noteId];
      searchIndexRef.current = next;
      return next;
    });
  }, []);

  const updateEditor = useCallback(
    (update: (current: EditorState) => EditorState) => {
      setEditor((current) => {
        if (!current) return current;
        const next = update(current);
        editorRef.current = next;
        return next;
      });
    },
    [],
  );

  const markEditorChanged = useCallback(
    (update: Partial<Pick<EditorState, "title" | "content" | "pinned" | "archived">>) => {
      updateEditor((current) => ({
        ...current,
        ...update,
        dirty: true,
        version: current.version + 1,
      }));
      setSyncStatus("idle");
    },
    [updateEditor],
  );

  const loadNotes = useCallback(async () => {
    const result = await requestJson<{ notes: EncryptedNoteSummary[] }>(
      "/api/notes",
    );
    setNotes(result.notes);
    return result.notes;
  }, []);

  const decryptTitles = useCallback(async (
    encryptedNotes: EncryptedNoteSummary[],
    key: CryptoKey,
  ) => {
    const entries = await Promise.all(
      encryptedNotes.map(async (note) => [
        note.id,
        note.hasExtraPassword
          ? "Protected note"
          : await decryptNoteTitle(note, key),
      ] as const),
    );
    setTitles(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    loadNotes().catch(() => setError("Notes could not be loaded."));
  }, [loadNotes]);

  useEffect(() => {
    const saved = window.localStorage.getItem("notes-theme");
    if (saved === "light" || saved === "dark" || saved === "system") {
      setTheme(saved);
    }
    const savedWidth = Number(window.localStorage.getItem("notes-sidebar-width"));
    if (savedWidth >= 240 && savedWidth <= 440) setSidebarWidth(savedWidth);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.classList.toggle("dark", resolved === "dark");
      document.documentElement.classList.toggle("light", resolved === "light");
      setColorMode(resolved);
    };
    update();
    window.localStorage.setItem("notes-theme", theme);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  const saveCurrentNote = useCallback(async () => {
    const snapshot = editorRef.current;
    if (!snapshot?.dirty || !masterKey) return;

    if (saveInFlightRef.current) {
      queuedSaveRef.current = true;
      return;
    }

    saveInFlightRef.current = true;
    setSyncStatus("saving");
    setError("");

    try {
      const plain = { title: snapshot.title, content: snapshot.content };
      const protection = snapshot.encrypted?.hasExtraPassword
        ? {
            extraPasswordSalt: snapshot.encrypted.extraPasswordSalt!,
            extraPasswordEncryptedNoteKey:
              snapshot.encrypted.extraPasswordEncryptedNoteKey!,
            extraPasswordNoteKeyIv:
              snapshot.encrypted.extraPasswordNoteKeyIv!,
          }
        : undefined;
      const input = await encryptNote(
        plain,
        snapshot.contentKey ?? masterKey,
        {
          pinned: snapshot.pinned,
          archived: snapshot.archived,
        },
        protection,
      );

      const url = snapshot.encrypted
        ? `/api/notes/${snapshot.encrypted.id}`
        : "/api/notes";
      const method = snapshot.encrypted ? "PUT" : "POST";
      const { note } = await requestJson<{ note: EncryptedNote }>(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      setNotes((current) =>
        sortNotes([...current.filter((item) => item.id !== note.id), note]),
      );
      setTitles((current) => ({
        ...current,
        [note.id]: note.hasExtraPassword
          ? "Protected note"
          : snapshot.title || "Untitled",
      }));
      updateSearchIndex({
        id: note.id,
        title: snapshot.title,
        content: snapshot.content,
        updatedAt: note.updatedAt,
      });
      setEditor((current) => {
        if (!current || current.session !== snapshot.session) return current;
        const unchanged = current.version === snapshot.version;
        const next = {
          ...current,
          encrypted: note,
          dirty: !unchanged,
        };
        editorRef.current = next;
        setSyncStatus(unchanged ? "saved" : "idle");
        return next;
      });
    } catch {
      setSyncStatus("error");
      setError("The note could not be synced.");
    } finally {
      saveInFlightRef.current = false;
      if (queuedSaveRef.current) {
        queuedSaveRef.current = false;
        window.setTimeout(() => void saveRef.current(), 0);
      }
    }
  }, [masterKey, updateSearchIndex]);

  useEffect(() => {
    saveRef.current = saveCurrentNote;
  }, [saveCurrentNote]);

  useEffect(() => {
    if (!editor?.dirty) return;
    const timeout = window.setTimeout(() => void saveRef.current(), autosaveDelayMs);
    return () => window.clearTimeout(timeout);
  }, [
    editor?.archived,
    editor?.content,
    editor?.dirty,
    editor?.pinned,
    editor?.title,
    editor?.version,
  ]);

  useEffect(() => {
    function handleShortcuts(event: KeyboardEvent) {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
      }
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
      if (command && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote();
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setSidebarOpen(false);
      }
    }
    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, []);

  useEffect(() => {
    if (!masterKey) return;
    decryptTitles(notes, masterKey).catch(() =>
      setError("Note titles could not be decrypted."),
    );
  }, [decryptTitles, masterKey, notes]);

  useEffect(() => {
    if (!masterKey) return;
    let cancelled = false;
    const noteIds = new Set(notes.map((note) => note.id));

    setSearchIndex((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(
          ([id, entry]) =>
            noteIds.has(id) &&
            notes.some((note) => note.id === id && note.updatedAt === entry.updatedAt),
        ),
      );
      searchIndexRef.current = next;
      return next;
    });

    const missing = notes.filter(
      (note) =>
        !note.hasExtraPassword &&
        searchIndexRef.current[note.id]?.updatedAt !== note.updatedAt,
    );
    if (!missing.length) {
      setIndexing(false);
      return;
    }

    setIndexing(true);
    Promise.all(
      missing.map(async (summary) => {
        const { note } = await requestJson<{ note: EncryptedNote }>(
          `/api/notes/${summary.id}`,
        );
        const plain = await decryptNote(note, masterKey);
        return {
          id: note.id,
          title: plain.title,
          content: plain.content,
          updatedAt: note.updatedAt,
        };
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        setSearchIndex((current) => {
          const next = { ...current };
          for (const entry of entries) next[entry.id] = entry;
          searchIndexRef.current = next;
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setError("The local search index could not be created.");
      })
      .finally(() => {
        if (!cancelled) setIndexing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [masterKey, notes]);

  async function openNote(noteId: string) {
    if (!masterKey) return;
    await saveRef.current();
    setError("");
    setWorking(true);
    try {
      const { note } = await requestJson<{ note: EncryptedNote }>(
        `/api/notes/${noteId}`,
      );
      if (note.hasExtraPassword) {
        setPasswordAction({ mode: "open", note });
        return;
      }
      const plain = await decryptNote(note, masterKey);
      updateSearchIndex({
        id: note.id,
        title: plain.title,
        content: plain.content,
        updatedAt: note.updatedAt,
      });
      sessionRef.current += 1;
      const next = {
        encrypted: note,
        ...plain,
        pinned: note.pinned,
        archived: note.archived,
        dirty: false,
        session: sessionRef.current,
        version: 0,
        contentKey: null,
      };
      setEditor(next);
      editorRef.current = next;
      setSyncStatus("saved");
      setMobilePane("edit");
    } catch {
      setError("The note could not be opened.");
    } finally {
      setWorking(false);
    }
  }

  async function createNote() {
    await saveRef.current();
    sessionRef.current += 1;
    const next: EditorState = {
      encrypted: null,
      title: "",
      content: "",
      pinned: false,
      archived: false,
      dirty: false,
      session: sessionRef.current,
      version: 0,
      contentKey: null,
    };
    setEditor(next);
    editorRef.current = next;
    setSyncStatus("idle");
    setMobilePane("edit");
    setSidebarOpen(false);
  }

  const searchResults = useMemo(
    () => searchMemoryIndex(searchIndex, query),
    [query, searchIndex],
  );
  const sidebarSearchResults = useMemo(
    () => new Map(searchResults.map((result) => [result.id, result])),
    [searchResults],
  );

  const filteredNotes = useMemo(() => {
    const searching = Boolean(query.trim());
    return notes.filter((note) => {
      if (filter === "favorites" && !note.pinned) return false;
      if (filter === "archived" && !note.archived) return false;
      if (filter !== "archived" && note.archived) return false;
      if (!searching) return true;
      return sidebarSearchResults.has(note.id);
    });
  }, [filter, notes, query, sidebarSearchResults]);

  function selectFilter(nextFilter: NoteFilter) {
    setFilter(nextFilter);
    setSidebarOpen(false);
  }

  function beginSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const resize = (moveEvent: PointerEvent) => {
      const next = Math.min(440, Math.max(240, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(next);
    };
    const finish = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", finish);
      setSidebarWidth((current) => {
        window.localStorage.setItem("notes-sidebar-width", String(current));
        return current;
      });
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", finish);
  }

  async function deleteNote() {
    if (!editor?.encrypted || !masterKey) return;
    setError("");
    setWorking(true);
    try {
      await requestJson(`/api/notes/${editor.encrypted.id}`, {
        method: "DELETE",
      });
      setNotes((current) =>
        current.filter((note) => note.id !== editor.encrypted?.id),
      );
      setTitles((current) => {
        const next = { ...current };
        delete next[editor.encrypted!.id];
        return next;
      });
      removeFromSearchIndex(editor.encrypted.id);
      setEditor(null);
      editorRef.current = null;
      setSyncStatus("idle");
    } catch {
      setError("The note could not be deleted.");
    } finally {
      setWorking(false);
    }
  }

  async function updateNoteProtection(
    input: EncryptedNoteInput,
    contentKey: CryptoKey | null,
  ) {
    const snapshot = editorRef.current;
    if (!snapshot?.encrypted) return;
    const { note } = await requestJson<{ note: EncryptedNote }>(
      `/api/notes/${snapshot.encrypted.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    setNotes((current) =>
      sortNotes([...current.filter((item) => item.id !== note.id), note]),
    );
    setTitles((current) => ({
      ...current,
      [note.id]: note.hasExtraPassword
        ? "Protected note"
        : snapshot.title || "Untitled",
    }));
    updateSearchIndex({
      id: note.id,
      title: snapshot.title,
      content: snapshot.content,
      updatedAt: note.updatedAt,
    });
    updateEditor((current) => ({
      ...current,
      encrypted: note,
      contentKey,
      dirty: false,
    }));
    setSyncStatus("saved");
  }

  async function handlePasswordAction(
    currentPassword: string,
    newPassword: string,
  ) {
    if (!passwordAction || !masterKey) return;
    setWorking(true);
    setError("");
    try {
      if (passwordAction.mode === "open") {
        const noteKey = await unlockProtectedNoteKey(
          passwordAction.note,
          currentPassword,
        );
        const plain = await decryptNote(passwordAction.note, masterKey, noteKey);
        updateSearchIndex({
          id: passwordAction.note.id,
          title: plain.title,
          content: plain.content,
          updatedAt: passwordAction.note.updatedAt,
        });
        sessionRef.current += 1;
        const next: EditorState = {
          encrypted: passwordAction.note,
          ...plain,
          pinned: passwordAction.note.pinned,
          archived: passwordAction.note.archived,
          dirty: false,
          session: sessionRef.current,
          version: 0,
          contentKey: noteKey,
        };
        setEditor(next);
        editorRef.current = next;
        setSyncStatus("saved");
        setMobilePane("edit");
      } else {
        await saveRef.current();
        const snapshot = editorRef.current;
        if (!snapshot?.encrypted) {
          throw new Error("Save the note before protecting it.");
        }
        if (passwordAction.mode === "protect") {
          const result = await protectNote(
            { title: snapshot.title, content: snapshot.content },
            newPassword,
            { pinned: snapshot.pinned, archived: snapshot.archived },
          );
          await updateNoteProtection(result.input, result.noteKey);
        } else if (passwordAction.mode === "change") {
          const result = await changeNoteExtraPassword(
            snapshot.encrypted,
            currentPassword,
            newPassword,
          );
          await updateNoteProtection(result.input, result.noteKey);
        } else {
          const input = await removeNoteExtraPassword(
            snapshot.encrypted,
            currentPassword,
            masterKey,
          );
          await updateNoteProtection(input, null);
        }
      }
      setPasswordAction(null);
    } catch {
      setError(
        passwordAction.mode === "open"
          ? "Incorrect additional password or damaged note."
          : "Protection could not be updated. Check the password.",
      );
    } finally {
      setWorking(false);
    }
  }

  if (loading || !unlocked) {
    return <Message>Loading encrypted vault...</Message>;
  }

  return (
    <>
      <main className="flex h-dvh overflow-hidden bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
        {sidebarOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          />
        ) : null}
        <aside
          style={{ width: sidebarWidth }}
          className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 flex max-w-[88vw] shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-transform lg:static lg:max-w-none lg:translate-x-0 dark:border-zinc-800 dark:bg-zinc-900`}
        >
          <div className="flex items-center gap-3 px-4 py-4">
            <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Notes</p>
              <p className="truncate text-xs text-zinc-500">{email}</p>
            </div>
          </div>

          <div className="space-y-1 px-2">
            <SidebarButton
              icon={<FiPlus aria-hidden />}
              label="New note"
              shortcut="⌘N"
              onClick={() => void createNote()}
            />
            <label className="relative block">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-zinc-400">
                <FiSearch aria-hidden />
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setPaletteOpen(false)}
                placeholder="Quick search"
                className="w-full rounded-md border-0 bg-transparent py-2 pr-10 pl-8 text-sm outline-none placeholder:text-zinc-500 hover:bg-zinc-200/60 focus:bg-white focus:ring-1 focus:ring-zinc-300 dark:hover:bg-zinc-800/70 dark:focus:bg-zinc-950 dark:focus:ring-zinc-700"
              />
              <button
                type="button"
                title="Open command palette"
                onClick={() => setPaletteOpen(true)}
                className="absolute inset-y-0 right-2 text-[10px] text-zinc-400"
              >
                <FiCommand aria-hidden />
              </button>
            </label>
            {indexing ? (
              <p className="px-2.5 text-[11px] text-zinc-400">Indexing notes locally...</p>
            ) : null}
          </div>

          <nav className="mt-5 space-y-1 px-2" aria-label="Note filters">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Workspace
            </p>
            <SidebarButton
              active={filter === "all"}
              icon={<FiFolder aria-hidden />}
              label="All notes"
              count={notes.filter((note) => !note.archived).length}
              onClick={() => selectFilter("all")}
            />
            <SidebarButton
              active={filter === "favorites"}
              icon={<FiStar aria-hidden />}
              label="Favorites"
              count={notes.filter((note) => note.pinned && !note.archived).length}
              onClick={() => selectFilter("favorites")}
            />
            <SidebarButton
              active={filter === "archived"}
              icon={<FiArchive aria-hidden />}
              label="Archived"
              count={notes.filter((note) => note.archived).length}
              onClick={() => selectFilter("archived")}
            />
          </nav>

          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <div className="px-4 pb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                {filter === "all"
                  ? "Notes"
                  : filter === "favorites"
                    ? "Favorites"
                    : "Archived"}
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
              {filteredNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => {
                    void openNote(note.id);
                    setSidebarOpen(false);
                  }}
                  className={`block w-full rounded-md px-2.5 py-2 text-left transition ${
                    editor?.encrypted?.id === note.id
                      ? "bg-zinc-200/80 dark:bg-zinc-800"
                      : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      <HighlightText
                        text={
                          query.trim() && sidebarSearchResults.get(note.id)
                            ? sidebarSearchResults.get(note.id)!.title || "Untitled"
                            : titles[note.id] === undefined
                            ? "Decrypting..."
                            : titles[note.id] || "Untitled"
                        }
                        query={query}
                      />
                    </span>
                    {note.pinned ? <FiStar className="shrink-0 fill-amber-400 text-amber-500" aria-label="Favorite" /> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500">
                    {note.hasExtraPassword ? <FiLock className="mr-1 inline" aria-label="Protected" /> : null}
                    {query.trim() && sidebarSearchResults.get(note.id)?.snippet ? (
                      <HighlightText
                        text={sidebarSearchResults.get(note.id)!.snippet}
                        query={query}
                      />
                    ) : (
                      formatCompactDate(note.updatedAt)
                    )}
                  </span>
                </button>
              ))}
              {!filteredNotes.length ? (
                <p className="px-2.5 py-3 text-xs text-zinc-500">
                  {query.trim()
                    ? "No local results. Protected notes require unlocking."
                    : "There are no notes in this section."}
                </p>
              ) : null}
            </div>
          </div>

          <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
            <Link
              to="/settings/security"
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <FiShield aria-hidden />
              Security
            </Link>
            <div className="mb-2 grid grid-cols-3 gap-1 rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800">
              {(["light", "dark", "system"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  title={themeLabel(option)}
                  onClick={() => setTheme(option)}
                  className={`rounded-md px-2 py-1.5 text-xs transition ${
                    theme === option
                      ? "bg-white font-medium shadow-sm dark:bg-zinc-700"
                      : "text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
                  }`}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    {option === "light" ? <FiSun aria-hidden /> : option === "dark" ? <FiMoon aria-hidden /> : <FiMonitor aria-hidden />}
                    <span className="hidden 2xl:inline">{option === "light" ? "Light" : option === "dark" ? "Dark" : "Auto"}</span>
                  </span>
                </button>
              ))}
            </div>
            <LogoutButton />
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={beginSidebarResize}
            className="absolute inset-y-0 right-0 hidden w-1 cursor-col-resize transition hover:bg-blue-500/40 lg:block"
          />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 px-3 sm:px-5 dark:border-zinc-800">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
              className="rounded-md p-2 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800"
            >
              <FiMenu aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {editor ? editor.title || "Untitled" : "All notes"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 sm:flex dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <FiSearch aria-hidden /> Search <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">⌘K</kbd>
            </button>
            {editor ? (
              <SyncIndicator status={syncStatus} updatedAt={editor.encrypted?.updatedAt} compact />
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl">
        <ErrorMessage message={error} />
        {editor ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveRef.current();
            }}
            className="space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-900">
              <input
                value={editor.title}
                onChange={(event) => markEditorChanged({ title: event.target.value })}
                placeholder="Untitled"
                className="min-w-0 flex-1 border-0 bg-transparent px-0 py-2 text-2xl font-semibold tracking-tight outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-700"
              />
            </div>

            <div className="flex gap-2 md:hidden">
              <PaneButton
                active={mobilePane === "edit"}
                onClick={() => setMobilePane("edit")}
              >
                Editor
              </PaneButton>
              <PaneButton
                active={mobilePane === "preview"}
                onClick={() => setMobilePane("preview")}
              >
                Preview
              </PaneButton>
            </div>

            <div
              data-color-mode={colorMode}
              className="grid min-h-[calc(100dvh-290px)] overflow-hidden rounded-lg border border-zinc-200 md:grid-cols-2 dark:border-zinc-800"
            >
              <div
                className={`${mobilePane === "edit" ? "block" : "hidden"} min-w-0 md:block`}
              >
                <MDEditor
                  value={editor.content}
                  onChange={(value) => markEditorChanged({ content: value ?? "" })}
                  preview="edit"
                  height="100%"
                  visibleDragbar={false}
                  textareaProps={{ placeholder: "Write in Markdown..." }}
                  className="!rounded-none !border-0 !shadow-none"
                />
              </div>
              <div
                className={`${mobilePane === "preview" ? "block" : "hidden"} min-w-0 overflow-auto border-zinc-200 bg-white p-5 md:block md:border-l dark:border-zinc-800 dark:bg-[#0d1117]`}
              >
                <MDEditor.Markdown
                  source={editor.content || "*The preview will appear here.*"}
                  rehypePlugins={[[rehypeSanitize]]}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-5 text-sm text-zinc-700 dark:text-zinc-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editor.pinned}
                    onChange={(event) =>
                      markEditorChanged({ pinned: event.target.checked })
                    }
                  />
                  Pinned
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editor.archived}
                    onChange={(event) =>
                      markEditorChanged({ archived: event.target.checked })
                    }
                  />
                  Archived
                </label>
              </div>
              <div className="flex gap-2">
                {editor.encrypted ? (
                  editor.encrypted.hasExtraPassword ? (
                    <>
                      <button
                        type="button"
                        disabled={working || syncStatus === "saving"}
                        onClick={() => setPasswordAction({ mode: "change" })}
                        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700"
                      >
                        <span className="flex items-center gap-2"><FiKey aria-hidden /> Change password</span>
                      </button>
                      <button
                        type="button"
                        disabled={working || syncStatus === "saving"}
                        onClick={() => setPasswordAction({ mode: "remove" })}
                        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700"
                      >
                        <span className="flex items-center gap-2"><FiUnlock aria-hidden /> Remove protection</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={working || syncStatus === "saving"}
                      onClick={() => setPasswordAction({ mode: "protect" })}
                      className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700"
                    >
                      <span className="flex items-center gap-2"><FiShield aria-hidden /> Protect note</span>
                    </button>
                  )
                ) : null}
                <PrimaryButton disabled={syncStatus === "saving"}>
                  <span className="flex items-center gap-2"><FiSave aria-hidden /> Save</span>
                </PrimaryButton>
                {editor.encrypted ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={deleteNote}
                    className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 dark:border-red-900 dark:text-red-300"
                  >
                    <span className="flex items-center gap-2"><FiTrash2 aria-hidden /> Delete</span>
                  </button>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-zinc-500">Autosave enabled · Ctrl/Cmd + S to save</p>
          </form>
        ) : (
          <div className="grid min-h-[70dvh] place-items-center text-center">
            <div>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-zinc-100 text-xl dark:bg-zinc-900"><FiFileText aria-hidden /></div>
              <h2 className="mt-4 text-lg font-semibold">Your notes workspace</h2>
              <p className="mt-1 text-sm text-zinc-500">Select a note or create a new one.</p>
              <PrimaryButton type="button" onClick={createNote} className="mt-5">
                <span className="flex items-center gap-2"><FiPlus aria-hidden /> New note</span>
              </PrimaryButton>
            </div>
          </div>
        )}
            </div>
          </div>
        </section>
      </main>
      {paletteOpen ? (
        <CommandPalette
          notes={notes}
          searchIndex={searchIndex}
          indexing={indexing}
          theme={theme}
          searchRef={searchRef}
          onClose={() => setPaletteOpen(false)}
          onCreate={() => void createNote()}
          onOpen={(noteId) => void openNote(noteId)}
          onFilter={selectFilter}
          onTheme={setTheme}
        />
      ) : null}
    {passwordAction ? (
      <ExtraPasswordDialog
        action={passwordAction}
        error={error}
        working={working}
        onCancel={() => setPasswordAction(null)}
        onSubmit={handlePasswordAction}
      />
    ) : null}
    </>
  );
}

function SidebarButton({
  active = false,
  icon,
  label,
  shortcut,
  count,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${
        active
          ? "bg-zinc-200/80 font-medium dark:bg-zinc-800"
          : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/70"
      }`}
    >
      <span className="grid w-4 shrink-0 place-items-center text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <span className="text-[10px] text-zinc-400">{shortcut}</span> : null}
      {count !== undefined ? <span className="text-xs text-zinc-400">{count}</span> : null}
    </button>
  );
}

function CommandPalette({
  notes,
  searchIndex,
  indexing,
  theme,
  searchRef,
  onClose,
  onCreate,
  onOpen,
  onFilter,
  onTheme,
}: {
  notes: EncryptedNoteSummary[];
  searchIndex: Record<string, SearchIndexEntry>;
  indexing: boolean;
  theme: ThemePreference;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onCreate: () => void;
  onOpen: (noteId: string) => void;
  onFilter: (filter: NoteFilter) => void;
  onTheme: (theme: ThemePreference) => void;
}) {
  const [value, setValue] = useState("");
  const normalized = value.trim().toLocaleLowerCase();
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const matchingNotes = normalized
    ? searchMemoryIndex(searchIndex, value).slice(0, 8)
    : Object.values(searchIndex).slice(0, 6).map((entry) => ({
        ...entry,
        snippet: createSearchSnippet(entry.content, ""),
      }));

  useEffect(() => {
    searchRef.current?.focus();
  }, [searchRef]);

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/35 px-4 pt-[12dvh] backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="h-fit w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <FiSearch className="text-zinc-400" aria-hidden />
          <input
            ref={searchRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter" && normalized && matchingNotes[0]) {
                event.preventDefault();
                run(() => onOpen(matchingNotes[0].id));
              }
            }}
            placeholder="Search notes or run a command..."
            className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"
          />
          <kbd className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-400 dark:border-zinc-700">
            <FiX aria-label="Escape" />
          </kbd>
        </div>
        <div className="max-h-[60dvh] overflow-y-auto p-2">
          {!normalized ? (
            <>
              <PaletteLabel>Actions</PaletteLabel>
              <PaletteButton icon={<FiPlus />} label="New note" detail="⌘N" onClick={() => run(onCreate)} />
              <PaletteButton icon={<FiFolder />} label="All notes" onClick={() => run(() => onFilter("all"))} />
              <PaletteButton icon={<FiStar />} label="Favorites" onClick={() => run(() => onFilter("favorites"))} />
              <PaletteButton icon={<FiArchive />} label="Archived" onClick={() => run(() => onFilter("archived"))} />
              <PaletteLabel>Appearance</PaletteLabel>
              {(["light", "dark", "system"] as const).map((option) => (
                <PaletteButton
                  key={option}
                  icon={option === "light" ? <FiSun /> : option === "dark" ? <FiMoon /> : <FiMonitor />}
                  label={themeLabel(option)}
                  detail={theme === option ? "Active" : undefined}
                  onClick={() => run(() => onTheme(option))}
                />
              ))}
            </>
          ) : null}
          {matchingNotes.length ? (
            <PaletteLabel>{normalized ? "Local results" : "Recent notes in memory"}</PaletteLabel>
          ) : null}
          {matchingNotes.map((result) => (
            <PaletteButton
              key={result.id}
              icon={noteById.get(result.id)?.hasExtraPassword ? <FiLock /> : <FiFileText />}
              label={<HighlightText text={result.title || "Untitled"} query={value} />}
              description={<HighlightText text={result.snippet} query={value} />}
              detail={formatCompactDate(result.updatedAt)}
              onClick={() => run(() => onOpen(result.id))}
            />
          ))}
          {normalized && !matchingNotes.length ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">
              {indexing ? "Creating local index..." : "No notes found."}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PaletteLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{children}</p>;
}

function PaletteButton({
  icon,
  label,
  description,
  detail,
  onClick,
}: {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      {icon ? <span className="grid shrink-0 place-items-center text-zinc-400">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description ? (
          <span className="mt-0.5 block truncate text-xs text-zinc-500">
            {description}
          </span>
        ) : null}
      </span>
      {detail ? <span className="text-xs text-zinc-400">{detail}</span> : null}
    </button>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const value = query.trim();
  if (!value) return text;
  const expression = new RegExp(
    `(${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  return text.split(expression).map((part, index) =>
    normalizeSearchText(part) === normalizeSearchText(value) ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/35"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function ExtraPasswordDialog({
  action,
  error,
  working,
  onCancel,
  onSubmit,
}: {
  action: PasswordAction;
  error: string;
  working: boolean;
  onCancel: () => void;
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const needsNewPassword = action.mode === "protect" || action.mode === "change";
  const needsCurrentPassword = action.mode !== "protect";
  const title = {
    open: "Open protected note",
    protect: "Protect note",
    change: "Change additional password",
    remove: "Remove additional protection",
  }[action.mode];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form
        autoComplete="off"
        data-form-type="other"
        onSubmit={(event) => {
          event.preventDefault();
          if (needsNewPassword && newPassword !== confirmation) return;
          void onSubmit(currentPassword, newPassword);
        }}
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900"
      >
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            This password is never sent to the server and cannot be recovered.
          </p>
        </div>
        <ErrorMessage message={error} />
        {needsCurrentPassword ? (
          <PasswordField
            name="note-unlock-secret"
            label={
              action.mode === "open"
                ? "Additional password"
                : "Current additional password"
            }
            value={currentPassword}
            onChange={setCurrentPassword}
          />
        ) : null}
        {needsNewPassword ? (
          <>
            <PasswordField
              name="note-new-secret"
              label="New additional password"
              value={newPassword}
              onChange={setNewPassword}
            />
            <PasswordField
              name="note-new-secret-confirmation"
              label="Confirm password"
              value={confirmation}
              onChange={setConfirmation}
            />
            {confirmation && newPassword !== confirmation ? (
              <p className="text-sm text-red-600">Passwords do not match.</p>
            ) : null}
          </>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={working}
            onClick={onCancel}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700"
          >
            Cancel
          </button>
          <PrimaryButton
            disabled={
              working ||
              (needsCurrentPassword && !currentPassword) ||
              (needsNewPassword &&
                (!newPassword || newPassword !== confirmation))
            }
          >
            {working ? "Processing..." : "Continue"}
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}

function PasswordField({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        type="password"
        name={name}
        required
        autoComplete="new-password"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-zinc-700"
      />
    </label>
  );
}

function SyncIndicator({
  status,
  updatedAt,
  compact = false,
}: {
  status: SyncStatus;
  updatedAt?: string;
  compact?: boolean;
}) {
  const labels: Record<SyncStatus, string> = {
    idle: "Unsaved changes",
    saving: "Saving...",
    saved: "Saved",
    error: "Save error",
  };
  const colors: Record<SyncStatus, string> = {
    idle: "bg-amber-500",
    saving: "bg-blue-500 animate-pulse",
    saved: "bg-emerald-500",
    error: "bg-red-500",
  };

  return (
    <div className="text-right text-xs text-zinc-500" aria-live="polite">
      <div className="flex items-center justify-end gap-2">
        <span className={`h-2 w-2 rounded-full ${colors[status]}`} />
        <span className={compact ? "hidden sm:inline" : undefined}>{labels[status]}</span>
      </div>
      <div className={compact ? "hidden" : "mt-1"}>
        {updatedAt ? `Modified ${formatModifiedDate(updatedAt)}` : "New note"}
      </div>
    </div>
  );
}

function formatModifiedDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function themeLabel(theme: ThemePreference) {
  return theme === "light"
    ? "Light theme"
    : theme === "dark"
      ? "Dark theme"
      : "Use system theme";
}

function PaneButton({
  active,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-2 text-sm font-semibold ${
        active
          ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-950"
          : "border border-zinc-300 dark:border-zinc-700"
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      className={`rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </p>
  ) : null;
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </p>
  );
}
