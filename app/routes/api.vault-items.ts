import { requireUser } from "~/lib/auth/session.server";
import {
  createEncryptedVaultItem,
  listEncryptedVaultItems,
  parseEncryptedVaultItemInput,
} from "~/lib/vault-items.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.vault-items";

export async function loader({ request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "vault_items_read", limit: 240, windowMs: 60_000 });
  const user = await requireUser(request);
  return Response.json({ items: await listEncryptedVaultItems(user._id) });
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "vault_items_write", limit: 120, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 });
  const input = parseEncryptedVaultItemInput(await request.json());
  return Response.json({ item: await createEncryptedVaultItem(user._id, input) }, { status: 201 });
}

