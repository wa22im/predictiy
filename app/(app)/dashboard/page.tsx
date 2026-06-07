export default function DashboardStub() {
  return (
    <main className="planner-bg min-h-screen flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="glass-panel p-8 max-w-md text-center">
        <p className="micro-label mb-3">Your Cockpit</p>
        <h1 className="font-display text-3xl tracking-tight mb-2">Dashboard</h1>
        <p className="text-muted-foreground text-sm leading-6">
          You have no pools yet. (Group creation arrives in Phase 2.)
        </p>
      </div>
    </main>
  );
}
