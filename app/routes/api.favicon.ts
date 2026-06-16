import { requireUser } from "~/lib/auth/session.server";
import { enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.favicon";

const MAX_ICON_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 4_000;

export async function loader({ request }: Route.LoaderArgs) {
  enforceRateLimit(request, {
    bucket: "favicon_read",
    limit: 300,
    windowMs: 60_000,
  });

  await requireUser(request);

  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain") ?? "");
  if (!domain) throw new Response("Invalid favicon domain.", { status: 400 });

  const icon =
    (await getPwaIcon(domain)) ??
    (await getGoogleFavicon(domain));

  if (!icon) {
    throw new Response("Favicon unavailable.", { status: 502 });
  }

  return new Response(icon.buffer, {
    headers: {
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
      "Content-Type": icon.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function getPwaIcon(domain: string) {
  const siteUrl = `https://${domain}`;

  const html = await safeTextFetch(siteUrl);
  if (!html) return null;

  const manifestHref = findManifestHref(html);
  if (!manifestHref) return null;

  const manifestUrl = resolveUrl(manifestHref, siteUrl);
  if (!manifestUrl) return null;

  const manifest = await safeJsonFetch<WebAppManifest>(manifestUrl);
  if (!manifest?.icons?.length) return null;

  const bestIcon = pickBestManifestIcon(manifest.icons);
  if (!bestIcon?.src) return null;

  const iconUrl = resolveUrl(bestIcon.src, manifestUrl);
  if (!iconUrl) return null;

  return safeImageFetch(iconUrl);
}

async function getGoogleFavicon(domain: string) {
  const source = new URL("https://www.google.com/s2/favicons");
  source.searchParams.set("domain", domain);
  source.searchParams.set("sz", "128");

  return safeImageFetch(source.toString());
}

async function safeTextFetch(url: string) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 favicon-fetcher",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("text/html")) return null;

    return await response.text();
  } catch {
    return null;
  }
}

async function safeJsonFetch<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 favicon-fetcher",
        Accept: "application/manifest+json, application/json",
      },
    });

    if (!response.ok) return null;

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function safeImageFetch(url: string) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 favicon-fetcher",
        Accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*",
      },
    });

    const contentType = response.headers.get("Content-Type") ?? "";

    if (!response.ok || !contentType.startsWith("image/")) {
      return null;
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_ICON_BYTES) {
      return null;
    }

    return {
      buffer,
      contentType,
    };
  } catch {
    return null;
  }
}

function findManifestHref(html: string) {
  const match = html.match(
    /<link[^>]+rel=["'][^"']*\bmanifest\b[^"']*["'][^>]*>/i,
  );

  if (!match) return null;

  const href = match[0].match(/href=["']([^"']+)["']/i)?.[1];

  return href ?? null;
}

function pickBestManifestIcon(icons: ManifestIcon[]) {
  const usableIcons = icons
    .filter((icon) => icon.src)
    .map((icon) => ({
      ...icon,
      score: getIconScore(icon),
    }))
    .sort((a, b) => b.score - a.score);

  return usableIcons[0] ?? null;
}

function getIconScore(icon: ManifestIcon) {
  let score = 0;

  const type = icon.type?.toLowerCase() ?? "";
  const purpose = icon.purpose?.toLowerCase() ?? "";
  const sizes = icon.sizes ?? "";

  if (type.includes("png")) score += 40;
  if (type.includes("webp")) score += 35;
  if (type.includes("svg")) score += 30;

  if (purpose.includes("any")) score += 20;
  if (!purpose.includes("maskable")) score += 10;

  const largestSize = sizes
    .split(/\s+/)
    .map((size) => {
      const match = size.match(/^(\d+)x(\d+)$/);
      if (!match) return 0;
      return Math.min(Number(match[1]), Number(match[2]));
    })
    .sort((a, b) => b - a)[0] ?? 0;

  if (largestSize >= 512) score += 50;
  else if (largestSize >= 192) score += 40;
  else if (largestSize >= 128) score += 30;
  else if (largestSize >= 64) score += 20;
  else score += largestSize / 10;

  return score;
}

function resolveUrl(value: string, base: string) {
  try {
    const url = new URL(value, base);

    if (url.protocol !== "https:") return null;

    return url.toString();
  } catch {
    return null;
  }
}

function normalizeDomain(value: string) {
  if (!value || value.length > 253 || /[\s/@?#]/.test(value)) return null;

  try {
    const hostname = new URL(`https://${value}`).hostname.toLocaleLowerCase();

    if (hostname !== value.toLocaleLowerCase() || !hostname.includes(".")) {
      return null;
    }

    return hostname;
  } catch {
    return null;
  }
}

type WebAppManifest = {
  icons?: ManifestIcon[];
};

type ManifestIcon = {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
};