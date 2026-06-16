import { requireUser } from "~/lib/auth/session.server";
import { enforceRateLimit } from "~/lib/security.server";
import { listVaultItemEvents } from "~/lib/vault-items.server";
import type { Route } from "./+types/api.vault-items.$itemId.events";

export async function loader({ params, request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "vault_items_read", limit: 240, windowMs: 60_000 });
  const user = await requireUser(request);
  if (!params.itemId) throw new Response("Vault item not found.", { status: 404 });
  const events = await listVaultItemEvents(user._id, params.itemId);
  if (!events) throw new Response("Vault item not found.", { status: 404 });
  return Response.json({ events });
}
