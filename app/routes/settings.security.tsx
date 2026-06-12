import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import {
  primaryButton,
  secondaryButton,
  SecurityError,
  SecurityLayout,
} from "~/components/security-layout";
import { requireUser } from "~/lib/auth/session.server";
import { getSecurityPreferences } from "~/lib/auth/users.server";

import type { Route } from "./+types/settings.security";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return {
    enabled: user.twoFactor?.enabled === true,
    backupCodesRemaining: user.twoFactor?.backupCodesHash.length ?? 0,
    enabledAt: user.twoFactor?.enabledAt?.toISOString() ?? null,
    securityPreferences: getSecurityPreferences(user),
  };
}

export default function SecuritySettings({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const resumedAction = useRef(false);

  useEffect(() => {
    if (resumedAction.current) return;
    const action = searchParams.get("action");
    if (action !== "disable" && action !== "regenerate") return;
    resumedAction.current = true;
    setSearchParams({}, { replace: true });
    void requestSensitiveAction(action);
  }, [searchParams, setSearchParams]);

  async function requestSensitiveAction(action: "disable" | "regenerate") {
    setError("");
    setWorking(true);
    try {
      const endpoint = action === "disable" ? "/api/2fa/disable" : "/api/2fa/backup-codes/regenerate";
      const response = await fetch(endpoint, { method: "POST" });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        backupCodes?: string[];
        requiresRecent2FA?: boolean;
        confirmUrl?: string;
      };
      if (response.status === 428 && result.requiresRecent2FA) {
        navigate(result.confirmUrl ?? "/auth/2fa/confirm");
        return;
      }
      if (!response.ok || !result.success) {
        setError(result.error ?? "No fue posible completar la operación.");
        return;
      }
      if (result.backupCodes) {
        navigate("/settings/security/2fa/backup-codes", {
          state: { backupCodes: result.backupCodes },
        });
      } else {
        window.location.reload();
      }
    } catch {
      setError("No fue posible completar la operación.");
    } finally {
      setWorking(false);
    }
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setWorking(true);
    const formData = new FormData(event.currentTarget);
    const preferences = {
      require2FAForExport: formData.get("require2FAForExport") === "on",
      require2FAForPasswordChange:
        formData.get("require2FAForPasswordChange") === "on",
      require2FAForCriticalNotes:
        formData.get("require2FAForCriticalNotes") === "on",
    };
    try {
      const response = await fetch("/api/security/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        requiresRecent2FA?: boolean;
        confirmUrl?: string;
      };
      if (response.status === 428 && result.requiresRecent2FA) {
        navigate(result.confirmUrl ?? "/auth/2fa/confirm");
        return;
      }
      if (!response.ok || !result.success) {
        setError(result.error ?? "No fue posible guardar las preferencias.");
      }
    } catch {
      setError("No fue posible guardar las preferencias.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <SecurityLayout title="Seguridad" description="Administra la autenticación de dos factores de tu cuenta.">
      <div className="space-y-6">
        <SecurityError message={error} />
        {!loaderData.enabled ? (
          <div>
            <h2 className="font-semibold">Autenticación de dos factores</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Protege el inicio de sesión con códigos TOTP de 6 dígitos.</p>
            <Link className={`${primaryButton} mt-4 inline-block`} to="/settings/security/2fa/setup">Activar 2FA</Link>
          </div>
        ) : (
          <>
            <div>
              <h2 className="font-semibold text-emerald-700 dark:text-emerald-400">2FA está activo</h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Códigos de respaldo disponibles: {loaderData.backupCodesRemaining}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
              <button type="button" className={secondaryButton} disabled={working} onClick={() => void requestSensitiveAction("regenerate")}>
                Regenerar códigos de respaldo
              </button>
              <button type="button" className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" disabled={working} onClick={() => void requestSensitiveAction("disable")}>
                Desactivar 2FA
              </button>
            </div>
          </>
        )}
        <form className="space-y-4 border-t border-zinc-200 pt-5 dark:border-zinc-800" onSubmit={savePreferences}>
          <div>
            <h2 className="font-semibold">Verificación adicional</h2>
            <p className="mt-1 text-sm text-zinc-500">Preferencias preparadas para acciones sensibles presentes y futuras.</p>
          </div>
          <PreferenceCheckbox name="require2FAForExport" label="Requerir 2FA reciente para exportar notas" defaultChecked={loaderData.securityPreferences.require2FAForExport} />
          <PreferenceCheckbox name="require2FAForPasswordChange" label="Requerir 2FA reciente para cambiar contraseña" defaultChecked={loaderData.securityPreferences.require2FAForPasswordChange} />
          <PreferenceCheckbox name="require2FAForCriticalNotes" label="Requerir 2FA reciente para notas críticas" defaultChecked={loaderData.securityPreferences.require2FAForCriticalNotes} />
          <button className={secondaryButton} disabled={working}>Guardar preferencias</button>
        </form>
      </div>
    </SecurityLayout>
  );
}

function PreferenceCheckbox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}
