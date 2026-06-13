import { z } from "zod";
import { requireUser } from "~/lib/auth/session.server";
import { deleteEncryptedFolder, parseEncryptedFolderInput, updateEncryptedFolder } from "~/lib/folders.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import type { Route } from "./+types/api.folders.$folderId";

const deleteSchema = z.object({ strategy: z.enum(["move-to-parent", "uncategorized", "archive-items"]) }).strict();

export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "folders_write", limit: 60, windowMs: 60_000 });
  const user = await requireUser(request);
  if (!params.folderId) throw new Response("Folder not found.", { status: 404 });
  if (request.method === "PATCH") {
    const folder = await updateEncryptedFolder(user._id, params.folderId, parseEncryptedFolderInput(await request.json()));
    if (!folder) throw new Response("Folder not found.", { status: 404 });
    return Response.json({ folder });
  }
  if (request.method === "DELETE") {
    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success) throw new Response("Invalid delete strategy.", { status: 400 });
    if (!(await deleteEncryptedFolder(user._id, params.folderId, parsed.data.strategy))) throw new Response("Folder not found.", { status: 404 });
    return Response.json({ deleted: true });
  }
  throw new Response("Method not allowed.", { status: 405 });
}

