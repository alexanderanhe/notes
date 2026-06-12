import type { ReactNode } from "react";
import { Link } from "react-router";

export function SecurityLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <section className="mx-auto max-w-2xl">
        <Link className="text-sm font-medium text-blue-600" to="/app">
          Volver a notas
        </Link>
        <header className="mt-6 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
        </header>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {children}
        </div>
      </section>
    </main>
  );
}

export function SecurityError({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </p>
  ) : null;
}

export const primaryButton =
  "rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60";
export const secondaryButton =
  "rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800";
export const codeInput =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-mono tracking-widest outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-950";
