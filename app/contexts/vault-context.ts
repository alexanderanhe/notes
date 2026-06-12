import { createContext, useContext } from "react";

export interface VaultContextValue {
  locked: boolean;
  unlocked: boolean;
  loading: boolean;
  masterKey: CryptoKey | null;
  clearVault: () => void;
}

export const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault() {
  const context = useContext(VaultContext);

  if (!context) {
    throw new Error("useVault debe usarse dentro de VaultProvider.");
  }

  return context;
}
