import { useState, type FormEvent } from "react";

import { AuthLayout, Field, FormError } from "~/components/auth-form";
import { requirePendingTwoFactorUser } from "~/lib/auth/session.server";

import type { Route } from "./+types/auth.2fa";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Two-factor verification | Notes" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requirePendingTwoFactorUser(request);
  return { backupCodesRemaining: user.twoFactor!.backupCodesHash.length };
}

export default function TwoFactorLogin({ loaderData }: Route.ComponentProps) {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setWorking(true);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    try {
      const response = await fetch("/api/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        sessionInvalidated?: boolean;
      };
      if (!response.ok || !result.success) {
        setError(result.error ?? "The code could not be verified.");
        if (result.sessionInvalidated) window.setTimeout(() => window.location.assign("/auth/login"), 900);
        return;
      }
      window.location.assign("/app");
    } catch {
      setError("The code could not be verified.");
    } finally {
      setWorking(false);
    }
  }

  async function cancel() {
    await fetch("/auth/logout", { method: "POST" });
    window.location.assign("/auth/login");
  }

  return (
    <AuthLayout
      title="Two-factor verification"
      description="Enter a code from your authenticator app or a backup code."
      footer={<button className="font-medium text-blue-600" type="button" onClick={() => void cancel()}>Cancel</button>}
    >
      <form className="space-y-5" onSubmit={submit}>
        <FormError message={error} />
        <Field label="Code" name="code" inputMode="text" autoComplete="one-time-code" maxLength={9} />
        <p className="text-xs text-zinc-500">
          Backup codes available: {loaderData.backupCodesRemaining}
        </p>
        <button disabled={working} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {working ? "Verifying..." : "Verify"}
        </button>
      </form>
    </AuthLayout>
  );
}
