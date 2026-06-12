import { requireRecent2FA, requireUser } from "~/lib/auth/session.server";
import {
  deleteEncryptedNote,
  getEncryptedNote,
  getEncryptedNoteSummary,
  parseEncryptedNoteInput,
  updateEncryptedNote,
} from "~/lib/notes.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import { removeNoteFromWorkspace } from "~/lib/workspace.server";

import type { Route } from "./+types/api.notes.$noteId";

function requireNoteId(noteId: string | undefined) {
  if (!noteId) {
    throw new Response("Note not found.", { status: 404 });
  }
  return noteId;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "notes_read", limit: 240, windowMs: 60_000 });
  const user = await requireUser(request);
  const noteId = requireNoteId(params.noteId);
  const summary = await getEncryptedNoteSummary(user._id, noteId);

  if (!summary) {
    throw new Response("Note not found.", { status: 404 });
  }
  if (summary.isCritical) {
    await requireRecent2FA(
      request,
      undefined,
      `/app?action=open-critical&noteId=${encodeURIComponent(noteId)}`,
    );
  }
  const note = await getEncryptedNote(user._id, noteId);
  if (!note) throw new Response("Note not found.", { status: 404 });

  return Response.json({ note });
}

export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "notes_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  const noteId = requireNoteId(params.noteId);
  const summary = await getEncryptedNoteSummary(user._id, noteId);

  if (!summary) throw new Response("Note not found.", { status: 404 });
  if (summary.isCritical) {
    await requireRecent2FA(request, undefined, "/app");
  }

  if (request.method === "DELETE") {
    if (!(await deleteEncryptedNote(user._id, noteId))) {
      throw new Response("Note not found.", { status: 404 });
    }
    await removeNoteFromWorkspace(user._id, noteId);
    return Response.json({ deleted: true });
  }

  if (request.method === "PUT") {
    const input = parseEncryptedNoteInput(await request.json());
    const note = await updateEncryptedNote(user._id, noteId, input);

    if (!note) {
      throw new Response("Note not found.", { status: 404 });
    }
    return Response.json({ note });
  }

  throw new Response("Method not allowed.", { status: 405 });
}
