import { useEffect, useMemo, useState, type ReactNode } from "react";

import { deviceRecoveryAdapter } from "~/lib/vault.client";

import { VaultContext, type VaultContextValue } from "./vault-context";

export function VaultProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    deviceRecoveryAdapter.recover(userId)
      .then((key) => {
        if (!active) return;
        if (!key) {
          window.location.replace("/auth/login?reauth=1");
          return;
        }
        setMasterKey(key);
      })
      .catch(() => {
        if (active) window.location.replace("/auth/login?reauth=1");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const value = useMemo<VaultContextValue>(
    () => ({
      locked: !loading && masterKey === null,
      unlocked: masterKey !== null,
      loading,
      masterKey,
      clearVault: () => setMasterKey(null),
    }),
    [loading, masterKey],
  );

  return (
    <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
  );
}
