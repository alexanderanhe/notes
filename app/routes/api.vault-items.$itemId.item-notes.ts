import { requireUser } from "~/lib/auth/session.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import { parseEncryptedItemNotesInput, setVaultItemEncryptedNotes } from "~/lib/vault-items.server";
import type { Route } from "./+types/api.vault-items.$itemId.item-notes";

export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "vault_items_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "PATCH" || !params.itemId) throw new Response("Method not allowed.", { status: 405 });
  const item = await setVaultItemEncryptedNotes(user._id, params.itemId, parseEncryptedItemNotesInput(await request.json()));
  if (!item) throw new Response("Vault item not found.", { status: 404 });
  return Response.json({ item });
}
