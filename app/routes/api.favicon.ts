import { requireUser } from "~/lib/auth/session.server";
import { enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.favicon";

const MAX_FAVICON_BYTES = 256 * 1024;

export async function loader({ request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "favicon_read", limit: 300, windowMs: 60_000 });
  await requireUser(request);
  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain") ?? "");
  if (!domain) throw new Response("Invalid favicon domain.", { status: 400 });

  const source = new URL("https://www.google.com/s2/favicons");
  source.searchParams.set("domain", domain);
  source.searchParams.set("sz", "128");
  const response = await fetch(source, { signal: AbortSignal.timeout(4_000) });
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!response.ok || !contentType.startsWith("image/")) {
    throw new Response("Favicon unavailable.", { status: 502 });
  }
  const favicon = await response.arrayBuffer();
  if (favicon.byteLength > MAX_FAVICON_BYTES) {
    throw new Response("Favicon is too large.", { status: 502 });
  }
  return new Response(favicon, {
    headers: {
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function normalizeDomain(value: string) {
  if (!value || value.length > 253 || /[\s/@?#]/.test(value)) return null;
  try {
    const hostname = new URL(`https://${value}`).hostname.toLocaleLowerCase();
    if (hostname !== value.toLocaleLowerCase() || !hostname.includes(".")) return null;
    return hostname;
  } catch {
    return null;
  }
}
