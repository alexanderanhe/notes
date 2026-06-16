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

  const icon = (await getBestSiteIcon(domain)) ?? (await getGoogleFavicon(domain));

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

async function getBestSiteIcon(domain: string) {
  const siteUrl = `https://${domain}`;

  const html = await safeTextFetch(siteUrl);

  if (html) {
    const manifestIcon = await getManifestIcon(html, siteUrl);
    if (manifestIcon) return manifestIcon;

    const htmlIcon = await getHtmlIcon(html, siteUrl);
    if (htmlIcon) return htmlIcon;
  }

  const faviconIco = await safeImageFetch(`${siteUrl}/favicon.ico`);
  if (faviconIco) return faviconIco;

  return null;
}

async function getManifestIcon(html: string, siteUrl: string) {
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

async function getHtmlIcon(html: string, siteUrl: string) {
  const links = findIconLinks(html);

  for (const link of links) {
    const iconUrl = resolveUrl(link.href, siteUrl);
    if (!iconUrl) continue;

    const icon = await safeImageFetch(iconUrl);
    if (icon) return icon;
  }

  return null;
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
        Accept: "image/avif,image/webp,image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/*,*/*",
      },
    });

    const contentType = normalizeImageContentType(response.headers.get("Content-Type") ?? "", url);

    if (!response.ok || !contentType) {
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
  const links = parseLinkTags(html);

  const manifest = links.find((link) => {
    const rel = link.rel.toLowerCase();

    return rel.split(/\s+/).includes("manifest");
  });

  return manifest?.href ?? null;
}

function findIconLinks(html: string) {
  const links = parseLinkTags(html);

  return links
    .filter((link) => {
      const relTokens = link.rel.toLowerCase().split(/\s+/);

      return (
        relTokens.includes("apple-touch-icon") ||
        relTokens.includes("apple-touch-icon-precomposed") ||
        relTokens.includes("icon") ||
        relTokens.includes("shortcut")
      );
    })
    .map((link) => ({
      ...link,
      score: getHtmlIconScore(link),
    }))
    .sort((a, b) => b.score - a.score);
}

function parseLinkTags(html: string): HtmlIconLink[] {
  const links: HtmlIconLink[] = [];
  const linkRegex = /<link\b[^>]*>/gi;

  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html))) {
    const tag = match[0];
    const rel = getAttribute(tag, "rel");
    const href = getAttribute(tag, "href");

    if (!rel || !href) continue;

    links.push({
      rel,
      href,
      type: getAttribute(tag, "type"),
      sizes: getAttribute(tag, "sizes"),
    });
  }

  return links;
}

function getAttribute(tag: string, name: string) {
  const regex = new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i");

  return tag.match(regex)?.[1] ?? null;
}

function getHtmlIconScore(link: HtmlIconLink) {
  let score = 0;

  const rel = link.rel.toLowerCase();
  const type = link.type?.toLowerCase() ?? "";
  const sizes = link.sizes ?? "";

  if (rel.includes("apple-touch-icon")) score += 80;
  if (rel.includes("icon")) score += 60;
  if (rel.includes("shortcut")) score += 40;

  if (type.includes("png")) score += 40;
  if (type.includes("webp")) score += 35;
  if (type.includes("svg")) score += 30;
  if (type.includes("x-icon") || type.includes("icon")) score += 20;

  const largestSize = getLargestIconSize(sizes);

  if (largestSize >= 512) score += 50;
  else if (largestSize >= 192) score += 40;
  else if (largestSize >= 128) score += 30;
  else if (largestSize >= 64) score += 20;
  else if (largestSize >= 32) score += 10;

  return score;
}

function pickBestManifestIcon(icons: ManifestIcon[]) {
  const usableIcons = icons
    .filter((icon) => icon.src)
    .map((icon) => ({
      ...icon,
      score: getManifestIconScore(icon),
    }))
    .sort((a, b) => b.score - a.score);

  return usableIcons[0] ?? null;
}

function getManifestIconScore(icon: ManifestIcon) {
  let score = 0;

  const type = icon.type?.toLowerCase() ?? "";
  const purpose = icon.purpose?.toLowerCase() ?? "";
  const sizes = icon.sizes ?? "";

  if (type.includes("png")) score += 40;
  if (type.includes("webp")) score += 35;
  if (type.includes("svg")) score += 30;

  if (purpose.includes("any")) score += 20;
  if (!purpose.includes("maskable")) score += 10;

  const largestSize = getLargestIconSize(sizes);

  if (largestSize >= 512) score += 50;
  else if (largestSize >= 192) score += 40;
  else if (largestSize >= 128) score += 30;
  else if (largestSize >= 64) score += 20;
  else score += largestSize / 10;

  return score;
}

function getLargestIconSize(sizes: string) {
  if (sizes.toLowerCase() === "any") return 512;

  return (
    sizes
      .split(/\s+/)
      .map((size) => {
        const match = size.match(/^(\d+)x(\d+)$/i);
        if (!match) return 0;

        return Math.min(Number(match[1]), Number(match[2]));
      })
      .sort((a, b) => b - a)[0] ?? 0
  );
}

function normalizeImageContentType(contentType: string, url: string) {
  const cleanContentType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

  if (cleanContentType.startsWith("image/")) {
    return cleanContentType;
  }

  const pathname = new URL(url).pathname.toLowerCase();

  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".ico")) return "image/x-icon";

  return null;
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

type HtmlIconLink = {
  rel: string;
  href: string;
  type: string | null;
  sizes: string | null;
};