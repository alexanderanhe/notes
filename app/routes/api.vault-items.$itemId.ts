import { requireUser } from "~/lib/auth/session.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";
import {
  deleteEncryptedVaultItem,
  getEncryptedVaultItem,
  parseEncryptedVaultItemInput,
  updateEncryptedVaultItem,
} from "~/lib/vault-items.server";
import { removeItemFromWorkspace } from "~/lib/workspace.server";

import type { Route } from "./+types/api.vault-items.$itemId";

function requireItemId(value: string | undefined) {
  if (!value) throw new Response("Vault item not found.", { status: 404 });
  return value;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "vault_items_read", limit: 240, windowMs: 60_000 });
  const user = await requireUser(request);
  const item = await getEncryptedVaultItem(user._id, requireItemId(params.itemId));
  if (!item) throw new Response("Vault item not found.", { status: 404 });
  return Response.json({ item });
}

export async function action({ params, request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "vault_items_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  const itemId = requireItemId(params.itemId);
  if (request.method === "DELETE") {
    if (!(await deleteEncryptedVaultItem(user._id, itemId))) {
      throw new Response("Vault item not found.", { status: 404 });
    }
    await removeItemFromWorkspace(user._id, itemId);
    return Response.json({ deleted: true });
  }
  if (request.method !== "PATCH") throw new Response("Method not allowed.", { status: 405 });
  const item = await updateEncryptedVaultItem(
    user._id,
    itemId,
    parseEncryptedVaultItemInput(await request.json()),
  );
  if (!item) throw new Response("Vault item not found.", { status: 404 });
  return Response.json({ item });
}
