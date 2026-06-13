import { z } from "zod";

import { requireUser } from "~/lib/auth/session.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import { getWorkspace, saveWorkspace } from "~/lib/workspace.server";
import { VAULT_ITEM_TYPES } from "~/lib/vault-items";

import type { Route } from "./+types/api.workspace";

const workspaceSchema = z
  .object({
    openNoteIds: z.array(z.string()).max(10),
    activeNoteId: z.string().nullable(),
    openItemIds: z.array(z.string()).max(10).optional(),
    activeItemId: z.string().nullable().optional(),
    activeFolderId: z.string().nullable().optional(),
    activeTypeFilter: z.enum(["all", ...VAULT_ITEM_TYPES]).nullable().optional(),
    activeTagFilter: z.null().optional(),
    sidebarExpandedFolders: z.array(z.string()).max(100).optional(),
    sidebarWidth: z.number(),
    sidebarCollapsed: z.boolean(),
    noteUiState: z.record(
      z.string(),
      z.object({
        scrollTop: z.number(),
        editorMode: z.enum(["edit", "preview", "split"]),
      }),
    ),
  })
  .strict();

export async function loader({ request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "workspace_read", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  return Response.json({ workspace: await getWorkspace(user._id) });
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "workspace_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "PATCH") {
    throw new Response("Method not allowed.", { status: 405 });
  }
  const parsed = workspaceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid workspace." }, { status: 400 });
  }
  return Response.json({ workspace: await saveWorkspace(user._id, parsed.data) });
}
