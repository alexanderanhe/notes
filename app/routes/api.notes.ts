import { requireUser } from "~/lib/auth/session.server";
import {
  createEncryptedNote,
  listEncryptedNotes,
  parseEncryptedNoteInput,
} from "~/lib/notes.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.notes";

export async function loader({ request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "notes_read", limit: 240, windowMs: 60_000 });
  const user = await requireUser(request);
  return Response.json({ notes: await listEncryptedNotes(user._id) });
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "notes_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);

  if (request.method !== "POST") {
    throw new Response("Método no permitido.", { status: 405 });
  }

  const input = parseEncryptedNoteInput(await request.json());
  return Response.json(
    { note: await createEncryptedNote(user._id, input) },
    { status: 201 },
  );
}
