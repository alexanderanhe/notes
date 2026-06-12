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
        setError(result.error ?? "The operation could not be completed.");
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
      setError("The operation could not be completed.");
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
        setError(result.error ?? "The preferences could not be saved.");
      }
    } catch {
      setError("The preferences could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <SecurityLayout title="Security" description="Manage two-factor authentication for your account.">
      <div className="space-y-6">
        <SecurityError message={error} />
        {!loaderData.enabled ? (
          <div>
            <h2 className="font-semibold">Two-factor authentication</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Protect sign in with 6-digit TOTP codes.</p>
            <Link className={`${primaryButton} mt-4 inline-block`} to="/settings/security/2fa/setup">Enable 2FA</Link>
          </div>
        ) : (
          <>
            <div>
              <h2 className="font-semibold text-emerald-700 dark:text-emerald-400">2FA is enabled</h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Backup codes available: {loaderData.backupCodesRemaining}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
              <button type="button" className={secondaryButton} disabled={working} onClick={() => void requestSensitiveAction("regenerate")}>
                Regenerate backup codes
              </button>
              <button type="button" className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" disabled={working} onClick={() => void requestSensitiveAction("disable")}>
                Disable 2FA
              </button>
            </div>
          </>
        )}
        <form className="space-y-4 border-t border-zinc-200 pt-5 dark:border-zinc-800" onSubmit={savePreferences}>
          <div>
            <h2 className="font-semibold">Additional verification</h2>
            <p className="mt-1 text-sm text-zinc-500">Preferences for current and future sensitive actions.</p>
          </div>
          <PreferenceCheckbox name="require2FAForExport" label="Require recent 2FA to export notes" defaultChecked={loaderData.securityPreferences.require2FAForExport} />
          <PreferenceCheckbox name="require2FAForPasswordChange" label="Require recent 2FA to change password" defaultChecked={loaderData.securityPreferences.require2FAForPasswordChange} />
          <PreferenceCheckbox name="require2FAForCriticalNotes" label="Require recent 2FA for critical notes" defaultChecked={loaderData.securityPreferences.require2FAForCriticalNotes} />
          <button className={secondaryButton} disabled={working}>Save preferences</button>
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
