import { requireUser } from "~/lib/auth/session.server";
import { enforceRateLimit } from "~/lib/security.server";
import { searchUnsplashPhotos } from "~/lib/unsplash.server";
import type { Route } from "./+types/api.unsplash.search";

export async function loader({ request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "unsplash_search", limit: 30, windowMs: 60_000 });
  await requireUser(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const page = Math.max(1, Math.min(100, Number(url.searchParams.get("page")) || 1));
  if (!query || query.length > 100) throw new Response("Enter a valid search.", { status: 400 });
  return Response.json(await searchUnsplashPhotos(query, page));
}

