import { z } from "zod";
import { requireUser } from "~/lib/auth/session.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import { setVaultItemFlag } from "~/lib/vault-items.server";
import type { Route } from "./+types/api.vault-items.$itemId.favorite";

const schema = z.object({ favorite: z.boolean() }).strict();
export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "vault_items_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "PATCH" || !params.itemId) throw new Response("Method not allowed.", { status: 405 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new Response("Invalid favorite value.", { status: 400 });
  const item = await setVaultItemFlag(user._id, params.itemId, "favorite", parsed.data.favorite);
  if (!item) throw new Response("Vault item not found.", { status: 404 });
  return Response.json({ item });
}

