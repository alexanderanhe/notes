import { useState, type FormEvent } from "react";
import { FiImage, FiMonitor, FiMoon, FiSearch, FiSun } from "react-icons/fi";
import { toast } from "sonner";

import { SecurityLayout } from "~/components/security-layout";
import { requireUser } from "~/lib/auth/session.server";
import { getBackgroundPreference, getThemePreference } from "~/lib/auth/users.server";
import { isUnsplashConfigured, type UnsplashPhoto } from "~/lib/unsplash.server";
import { applyTheme, useThemePreference } from "~/lib/theme";

import type { Route } from "./+types/settings.appearance";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return {
    theme: getThemePreference(user),
    backgroundUrl: getBackgroundPreference(user),
    unsplashConfigured: isUnsplashConfigured(),
  };
}

export default function AppearanceSettings({ loaderData }: Route.ComponentProps) {
  const [theme, setTheme] = useState(loaderData.theme);
  const [backgroundUrl, setBackgroundUrl] = useState(loaderData.backgroundUrl);
  const [manualUrl, setManualUrl] = useState(loaderData.backgroundUrl ?? "");
  const [query, setQuery] = useState("");
  const [photos, setPhotos] = useState<UnsplashPhoto[]>([]);
  const [working, setWorking] = useState(false);
  useThemePreference(theme);

  async function saveTheme(nextTheme: typeof theme) {
    const response = await fetch("/api/preferences/theme", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: nextTheme }),
    });
    if (!response.ok) return toast.error("The theme could not be saved.");
    setTheme(nextTheme);
    applyTheme(nextTheme);
    toast.success("Theme saved");
  }

  async function saveBackground(nextUrl: string | null, downloadLocation?: string) {
    setWorking(true);
    try {
      const response = await fetch("/api/preferences/background", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backgroundUrl: nextUrl ?? "" }),
      });
      if (!response.ok) throw new Error();
      if (downloadLocation) {
        void fetch("/api/unsplash/download", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ downloadLocation }),
        });
      }
      setBackgroundUrl(nextUrl);
      setManualUrl(nextUrl ?? "");
      toast.success(nextUrl ? "Background saved" : "Default background restored");
    } catch {
      toast.error("The background could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/unsplash/search?q=${encodeURIComponent(query.trim())}`);
      if (!response.ok) throw new Error();
      const result = await response.json() as { photos: UnsplashPhoto[] };
      setPhotos(result.photos);
    } catch {
      toast.error("Unsplash search is unavailable.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <SecurityLayout title="Appearance" description="Customize the theme and workspace background." wide>
      <div className="space-y-8">
        <section>
          <h2 className="font-semibold">Theme</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["light", "dark", "system"] as const).map((option) => (
              <button key={option} type="button" onClick={() => void saveTheme(option)} className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm capitalize ${theme === option ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" : "border-zinc-300 dark:border-zinc-700"}`}>
                {option === "light" ? <FiSun /> : option === "dark" ? <FiMoon /> : <FiMonitor />}{option}
              </button>
            ))}
          </div>
        </section>

        <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="font-semibold">Workspace background</h2>
          <div className="mt-3 aspect-[16/7] overflow-hidden rounded-xl border border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950">
            {backgroundUrl ? <img src={backgroundUrl} alt="Current workspace background" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-sm text-zinc-500"><FiImage className="mb-2 inline" /> Default light and dark backgrounds</div>}
          </div>
          <div className="mt-3 flex gap-2">
            <input type="url" value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} placeholder="https://images.unsplash.com/..." className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700" />
            <button type="button" disabled={working || !manualUrl.trim()} onClick={() => void saveBackground(manualUrl.trim())} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Apply</button>
            <button type="button" disabled={working} onClick={() => void saveBackground(null)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">Default</button>
          </div>
        </section>

        <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="font-semibold">Search Unsplash</h2>
          {!loaderData.unsplashConfigured ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Set <code>UNSPLASH_ACCESS_KEY</code> on the server to enable image search.</p>
          ) : (
            <>
              <form onSubmit={search} className="mt-3 flex gap-2">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mountains, city, minimal..." className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700" />
                <button disabled={working || !query.trim()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><FiSearch />Search</button>
              </form>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {photos.map((photo) => (
                  <article key={photo.id} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
                    <button type="button" onClick={() => void saveBackground(photo.backgroundUrl, photo.downloadLocation)} className="block aspect-video w-full overflow-hidden">
                      <img src={photo.thumbnailUrl} alt={photo.alt} loading="lazy" className="h-full w-full object-cover transition-transform hover:scale-105" />
                    </button>
                    <p className="px-3 py-2 text-xs text-zinc-500">
                      Photo by <a href={photo.photographerUrl} target="_blank" rel="noreferrer" className="font-medium text-blue-600">{photo.photographerName}</a> on <a href="https://unsplash.com/?utm_source=notes&utm_medium=referral" target="_blank" rel="noreferrer" className="font-medium text-blue-600">Unsplash</a>
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="font-semibold">Organizing your vault</h2>
          <p className="mt-2 text-sm text-zinc-500">Open <strong>Personal Vault</strong> from the notes sidebar. Use the <strong>+</strong> beside Folders to create a folder or subfolder. Open an item and use the <strong>Tags</strong> field to add encrypted tags.</p>
        </section>
      </div>
    </SecurityLayout>
  );
}
