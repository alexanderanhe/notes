import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { AuthLayout, Field, FormError } from "~/components/auth-form";
import {
  getRecentTwoFactorRedirect,
  requireUser,
} from "~/lib/auth/session.server";

import type { Route } from "./+types/auth.2fa.confirm";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Confirm action | Notes" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  if (!user.twoFactor?.enabled) {
    throw new Response("Two-factor authentication is not enabled.", {
      status: 403,
    });
  }
  const redirectTo = await getRecentTwoFactorRedirect(request);
  return {
    redirectTo,
    criticalNote: redirectTo.includes("action=open-critical"),
  };
}

export default function ConfirmTwoFactorAction({
  loaderData,
}: Route.ComponentProps) {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setWorking(true);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    try {
      const response = await fetch("/api/2fa/confirm-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        redirectTo?: string;
        sessionInvalidated?: boolean;
      };
      if (!response.ok || !result.success) {
        setError(result.error ?? "The action could not be confirmed.");
        if (result.sessionInvalidated) {
          window.setTimeout(() => window.location.assign("/auth/login"), 900);
        }
        return;
      }
      window.location.assign(result.redirectTo ?? loaderData.redirectTo);
    } catch {
      setError("The action could not be confirmed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <AuthLayout
      title={loaderData.criticalNote ? "Critical note locked" : "Confirm this action"}
      description={
        loaderData.criticalNote
          ? "Confirm your second factor before accessing encrypted content."
          : "This operation requires recent 2FA verification."
      }
      footer={
        <Link className="font-medium text-blue-600" to={loaderData.redirectTo}>
          Cancel
        </Link>
      }
    >
      <form className="space-y-5" onSubmit={submit}>
        <FormError message={error} />
        <Field
          label="TOTP code or backup code"
          name="code"
          inputMode="text"
          autoComplete="one-time-code"
          maxLength={9}
        />
        <button
          disabled={working}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {working ? "Confirming..." : "Confirm"}
        </button>
      </form>
    </AuthLayout>
  );
}
