import { NotesDesktop } from "~/components/notes-desktop";
import { CryptoProvider } from "~/contexts/crypto-provider";
import { VaultProvider } from "~/contexts/vault-provider";
import { WorkspaceProvider } from "~/contexts/workspace-context";
import { FolderProvider } from "~/contexts/folder-context";
import { requireUser } from "~/lib/auth/session.server";
import { getBackgroundPreference, getThemePreference } from "~/lib/auth/users.server";

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
    backgroundUrl: getBackgroundPreference(user),
  };
}

export default function PrivateApp({ loaderData }: Route.ComponentProps) {
  return (
    <CryptoProvider>
      <VaultProvider userId={loaderData.userId}>
        <FolderProvider>
          <WorkspaceProvider>
            <AppScreen email={loaderData.email} theme={loaderData.theme} backgroundUrl={loaderData.backgroundUrl} />
          </WorkspaceProvider>
        </FolderProvider>
      </VaultProvider>
    </CryptoProvider>
  );
}

function AppScreen({
  email,
  theme,
  backgroundUrl,
}: {
  email: string;
  theme: "light" | "dark" | "system";
  backgroundUrl: string | null;
}) {
  return <NotesDesktop email={email} initialTheme={theme} initialBackgroundUrl={backgroundUrl} />;
}
