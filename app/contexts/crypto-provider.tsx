import { createContext, useContext, useMemo, type ReactNode } from "react";

import * as cryptoClient from "~/lib/crypto.client";

interface CryptoContextValue {
  isSupported: boolean;
  crypto: typeof cryptoClient;
}

const CryptoContext = createContext<CryptoContextValue | null>(null);

export function CryptoProvider({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({
      isSupported: Boolean(globalThis.crypto?.subtle),
      crypto: cryptoClient,
    }),
    [],
  );

  return (
    <CryptoContext.Provider value={value}>{children}</CryptoContext.Provider>
  );
}

export function useCrypto() {
  const context = useContext(CryptoContext);

  if (!context) {
    throw new Error("useCrypto must be used within CryptoProvider.");
  }

  return context;
}
