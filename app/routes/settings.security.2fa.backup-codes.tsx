import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { primaryButton, SecurityLayout } from "~/components/security-layout";
import { requireUser } from "~/lib/auth/session.server";

import type { Route } from "./+types/settings.security.2fa.backup-codes";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { remaining: user.twoFactor?.backupCodesHash.length ?? 0 };
}

export default function BackupCodes({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [codes] = useState(
    () => (location.state as { backupCodes?: string[] } | null)?.backupCodes,
  );

  useEffect(() => {
    if (codes?.length) navigate(location.pathname, { replace: true, state: null });
  }, [codes, location.pathname, navigate]);

  return (
    <SecurityLayout title="Códigos de respaldo" description="Cada código funciona una sola vez. Guárdalos en un lugar seguro.">
      {codes?.length ? (
        <div className="space-y-5">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Esta es la única vez que se mostrarán estos códigos.
          </p>
          <ul className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-100 p-4 font-mono dark:bg-zinc-950">
            {codes.map((code) => <li key={code}>{code}</li>)}
          </ul>
          <Link className={`${primaryButton} inline-block`} replace to="/settings/security">Ya guardé los códigos</Link>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Los códigos ya no están disponibles para mostrarse. Quedan {loaderData.remaining}.
          </p>
          <Link className={`${primaryButton} inline-block`} to="/settings/security">Volver a seguridad</Link>
        </div>
      )}
    </SecurityLayout>
  );
}
