import Link from "next/link";

export default function AdminHome() {
  return (
    <main className="planner-bg min-h-screen flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="max-w-3xl w-full">
        <p className="micro-label mb-3">Operational Control Room</p>
        <h1 className="font-display text-5xl md:text-6xl tracking-tight mb-4">
          Admin
        </h1>
        <p className="text-muted-foreground leading-7 mb-12">
          Manage competition data, settle markets, and oversee the platform.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          <Link
            href="/admin/hydration"
            className="paper-card p-6 hover:-translate-y-0.5 transition-transform"
          >
            <p className="micro-label mb-2">Data Hydration</p>
            <h2 className="font-display text-2xl font-bold tracking-tight mb-2">
              Hydration Terminal
            </h2>
            <p className="text-muted-foreground text-sm leading-6">
              Upload competition schedules and initialize new tournaments.
            </p>
          </Link>

          <Link
            href="/admin/settlement"
            className="paper-card p-6 opacity-60 cursor-not-allowed"
            aria-disabled
          >
            <p className="micro-label mb-2">Market Settlement</p>
            <h2 className="font-display text-2xl font-bold tracking-tight mb-2">
              Settlement Hub
            </h2>
            <p className="text-muted-foreground text-sm leading-6">
              Log match scores and settle markets. (Coming in Phase 5)
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
