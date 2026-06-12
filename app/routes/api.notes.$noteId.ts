import { requireUser } from "~/lib/auth/session.server";
import {
  deleteEncryptedNote,
  getEncryptedNote,
  parseEncryptedNoteInput,
  updateEncryptedNote,
} from "~/lib/notes.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.notes.$noteId";

function requireNoteId(noteId: string | undefined) {
  if (!noteId) {
    throw new Response("Nota no encontrada.", { status: 404 });
  }
  return noteId;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "notes_read", limit: 240, windowMs: 60_000 });
  const user = await requireUser(request);
  const note = await getEncryptedNote(user._id, requireNoteId(params.noteId));

  if (!note) {
    throw new Response("Nota no encontrada.", { status: 404 });
  }

  return Response.json({ note });
}

export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "notes_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  const noteId = requireNoteId(params.noteId);

  if (request.method === "DELETE") {
    if (!(await deleteEncryptedNote(user._id, noteId))) {
      throw new Response("Nota no encontrada.", { status: 404 });
    }
    return Response.json({ deleted: true });
  }

  if (request.method === "PUT") {
    const input = parseEncryptedNoteInput(await request.json());
    const note = await updateEncryptedNote(user._id, noteId, input);

    if (!note) {
      throw new Response("Nota no encontrada.", { status: 404 });
    }
    return Response.json({ note });
  }

  throw new Response("Método no permitido.", { status: 405 });
}
