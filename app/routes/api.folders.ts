import { requireUser } from "~/lib/auth/session.server";
import { createEncryptedFolder, listEncryptedFolders, parseEncryptedFolderInput } from "~/lib/folders.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import type { Route } from "./+types/api.folders";

export async function loader({ request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "folders_read", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  return Response.json({ folders: await listEncryptedFolders(user._id) });
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "folders_write", limit: 60, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 });
  return Response.json({ folder: await createEncryptedFolder(user._id, parseEncryptedFolderInput(await request.json())) }, { status: 201 });
}

