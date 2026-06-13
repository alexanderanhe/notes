import { z } from "zod";
import { requireUser } from "~/lib/auth/session.server";
import { moveEncryptedFolder } from "~/lib/folders.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import type { Route } from "./+types/api.folders.$folderId.move";

const schema = z.object({ parentFolderId: z.string().nullable() }).strict();

export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "folders_write", limit: 60, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "POST" || !params.folderId) throw new Response("Method not allowed.", { status: 405 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new Response("Invalid folder move.", { status: 400 });
  const folder = await moveEncryptedFolder(user._id, params.folderId, parsed.data.parentFolderId);
  if (!folder) throw new Response("Folder not found.", { status: 404 });
  return Response.json({ folder });
}

