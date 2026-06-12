import { requireUser } from "~/lib/auth/session.server";
import {
  getUserVaultEnvelope,
  setUserVaultEnvelope,
} from "~/lib/auth/users.server";
import { vaultEnvelopeSchema } from "~/lib/auth/schemas";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.vault";

export async function loader({ request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "vault_read", limit: 60, windowMs: 60_000 });
  const user = await requireUser(request);
  return Response.json({ vault: getUserVaultEnvelope(user) });
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "vault_write", limit: 10, windowMs: 60_000 });
  const user = await requireUser(request);
  if (request.method !== "PUT") {
    throw new Response("Method not allowed.", { status: 405 });
  }

  const vault = vaultEnvelopeSchema.safeParse(await request.json());
  if (!vault.success) {
    throw new Response("Invalid vault envelope.", { status: 400 });
  }

  if (!(await setUserVaultEnvelope(user._id, vault.data))) {
    throw new Response("The vault is already initialized.", { status: 409 });
  }
  return Response.json({ vault: vault.data });
}
