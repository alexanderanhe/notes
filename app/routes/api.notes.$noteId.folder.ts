import { z } from "zod";
import { requireUser } from "~/lib/auth/session.server";
import { setNoteFolder } from "~/lib/notes.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import type { Route } from "./+types/api.notes.$noteId.folder";

const schema = z.object({ folderId: z.string().nullable() }).strict();

export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "notes_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "PATCH" || !params.noteId) throw new Response("Method not allowed.", { status: 405 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new Response("Invalid folder.", { status: 400 });
  const note = await setNoteFolder(user._id, params.noteId, parsed.data.folderId);
  if (!note) throw new Response("Note not found.", { status: 404 });
  return Response.json({ note });
}
