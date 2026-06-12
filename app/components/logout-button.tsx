import { useState } from "react";
import { FiLogOut } from "react-icons/fi";

import { deviceRecoveryAdapter } from "~/lib/vault.client";

export function LogoutButton() {
  const [working, setWorking] = useState(false);

  async function logout() {
    setWorking(true);
    try {
      await deviceRecoveryAdapter.clear();
      await fetch("/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/auth/login");
    }
  }

  return (
    <button
      type="button"
      disabled={working}
      onClick={logout}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      <FiLogOut aria-hidden />
      {working ? "Signing out..." : "Sign out"}
    </button>
  );
}
