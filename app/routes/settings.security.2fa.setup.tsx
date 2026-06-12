import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { codeInput, primaryButton, SecurityError, SecurityLayout } from "~/components/security-layout";
import { requireUser } from "~/lib/auth/session.server";

import type { Route } from "./+types/settings.security.2fa.setup";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  if (user.twoFactor?.enabled) throw new Response("2FA is already enabled.", { status: 409 });
  return null;
}

export default function TwoFactorSetup() {
  const navigate = useNavigate();
  const [setup, setSetup] = useState<{ qrDataUrl: string; manualKey: string } | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch("/api/2fa/setup/start", { method: "POST" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setSetup(result);
      })
      .catch(() => setError("Setup could not be started."));
  }, []);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    try {
      const response = await fetch("/api/2fa/setup/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string; backupCodes?: string[] };
      if (!response.ok || !result.backupCodes) {
        setError(result.error ?? "2FA could not be enabled.");
        return;
      }
      navigate("/settings/security/2fa/backup-codes", { state: { backupCodes: result.backupCodes }, replace: true });
    } catch {
      setError("2FA could not be enabled.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <SecurityLayout title="Enable 2FA" description="Scan the QR code with your authenticator app and confirm a code.">
      <div className="space-y-5">
        <SecurityError message={error} />
        {!setup ? <p className="text-sm text-zinc-500">Generating setup...</p> : (
          <>
            <img className="mx-auto rounded-xl" src={setup.qrDataUrl} alt="QR code to configure TOTP" width={280} height={280} />
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Manual key:</p>
              <code className="mt-1 block break-all rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-950">{setup.manualKey}</code>
            </div>
            <form className="space-y-4" onSubmit={confirm}>
              <label className="block text-sm font-medium">6-digit code
                <input className={`${codeInput} mt-2`} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
              </label>
              <button className={primaryButton} disabled={working}>{working ? "Confirming..." : "Confirm and enable"}</button>
            </form>
          </>
        )}
      </div>
    </SecurityLayout>
  );
}
