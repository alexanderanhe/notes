import { z } from "zod";
import { requireRecent2FA, requireUser } from "~/lib/auth/session.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import { setVaultItemFlag } from "~/lib/vault-items.server";
import type { Route } from "./+types/api.vault-items.$itemId.recent-2fa";

const schema = z.object({ requiresRecent2FA: z.boolean() }).strict();

export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "vault_items_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "PATCH" || !params.itemId) throw new Response("Method not allowed.", { status: 405 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new Response("Invalid 2FA value.", { status: 400 });
  if (user.twoFactor?.enabled) await requireRecent2FA(request, undefined, "/app");
  const item = await setVaultItemFlag(user._id, params.itemId, "requiresRecent2FA", parsed.data.requiresRecent2FA);
  if (!item) throw new Response("Vault item not found.", { status: 404 });
  return Response.json({ item });
}
