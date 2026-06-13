import { z } from "zod";
import { requireUser } from "~/lib/auth/session.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import { trackUnsplashDownload } from "~/lib/unsplash.server";
import type { Route } from "./+types/api.unsplash.download";

const schema = z.object({ downloadLocation: z.string().url().max(2_048) }).strict();

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "unsplash_download", limit: 60, windowMs: 60_000 });
  await requireUser(request);
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new Response("Invalid Unsplash photo.", { status: 400 });
  await trackUnsplashDownload(parsed.data.downloadLocation);
  return Response.json({ success: true });
}

