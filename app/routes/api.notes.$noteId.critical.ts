import { z } from "zod";

import { requireRecent2FA } from "~/lib/auth/session.server";
import { setNoteCritical } from "~/lib/notes.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.notes.$noteId.critical";

const criticalSchema = z.object({ isCritical: z.boolean() }).strict();

export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, {
    bucket: "notes_critical",
    limit: 20,
    windowMs: 15 * 60_000,
  });
  if (request.method !== "POST" || !params.noteId) {
    throw new Response("Method not allowed.", { status: 405 });
  }
  const parsed = criticalSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const user = await requireRecent2FA(
    request,
    undefined,
    `/app?action=set-critical&noteId=${encodeURIComponent(params.noteId)}&value=${parsed.data.isCritical ? "true" : "false"}`,
  );
  const note = await setNoteCritical(user._id, params.noteId, parsed.data.isCritical);
  if (!note) throw new Response("Note not found.", { status: 404 });
  return Response.json({ success: true, note });
}
