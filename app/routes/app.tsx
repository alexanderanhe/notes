import { NotesDesktop } from "~/components/notes-desktop";
import { CryptoProvider } from "~/contexts/crypto-provider";
import { VaultProvider } from "~/contexts/vault-provider";
import { requireUser } from "~/lib/auth/session.server";
import { getThemePreference } from "~/lib/auth/users.server";

import type { Route } from "./+types/app";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Notes" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return {
    email: user.email,
    userId: user._id.toHexString(),
    theme: getThemePreference(user),
  };
}

export default function PrivateApp({ loaderData }: Route.ComponentProps) {
  return (
    <CryptoProvider>
      <VaultProvider userId={loaderData.userId}>
        <AppScreen email={loaderData.email} theme={loaderData.theme} />
      </VaultProvider>
    </CryptoProvider>
  );
}

function AppScreen({
  email,
  theme,
}: {
  email: string;
  theme: "light" | "dark" | "system";
}) {
  return <NotesDesktop email={email} initialTheme={theme} />;
}
