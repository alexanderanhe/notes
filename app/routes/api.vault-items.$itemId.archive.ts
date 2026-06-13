import { z } from "zod";
import { requireUser } from "~/lib/auth/session.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import { setVaultItemFlag } from "~/lib/vault-items.server";
import type { Route } from "./+types/api.vault-items.$itemId.archive";

const schema = z.object({ archived: z.boolean() }).strict();
export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "vault_items_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "PATCH" || !params.itemId) throw new Response("Method not allowed.", { status: 405 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new Response("Invalid archive value.", { status: 400 });
  const item = await setVaultItemFlag(user._id, params.itemId, "archived", parsed.data.archived);
  if (!item) throw new Response("Vault item not found.", { status: 404 });
  return Response.json({ item });
}
