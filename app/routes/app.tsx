import { NotesWorkspace } from "~/components/notes-workspace";
import { CryptoProvider } from "~/contexts/crypto-provider";
import { VaultProvider } from "~/contexts/vault-provider";
import { requireUser } from "~/lib/auth/session.server";

import type { Route } from "./+types/app";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Notas privadas" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { email: user.email, userId: user._id.toHexString() };
}

export default function PrivateApp({ loaderData }: Route.ComponentProps) {
  return (
    <CryptoProvider>
      <VaultProvider userId={loaderData.userId}>
        <AppScreen email={loaderData.email} />
      </VaultProvider>
    </CryptoProvider>
  );
}

function AppScreen({ email }: { email: string }) {
  return <NotesWorkspace email={email} />;
}
