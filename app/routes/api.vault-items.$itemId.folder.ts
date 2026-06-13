import { z } from "zod";
import { requireUser } from "~/lib/auth/session.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import { setVaultItemFolder } from "~/lib/vault-items.server";
import type { Route } from "./+types/api.vault-items.$itemId.folder";

const schema = z.object({ folderId: z.string().nullable() }).strict();

export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "vault_items_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "PATCH" || !params.itemId) throw new Response("Method not allowed.", { status: 405 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new Response("Invalid folder.", { status: 400 });
  const item = await setVaultItemFolder(user._id, params.itemId, parsed.data.folderId);
  if (!item) throw new Response("Vault item not found.", { status: 404 });
  return Response.json({ item });
}

