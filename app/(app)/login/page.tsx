export default function LoginStub() {
  return (
    <main className="planner-bg min-h-screen flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="glass-panel p-8 max-w-md w-full text-center">
        <p className="micro-label mb-3">Sign In</p>
        <h1 className="font-display text-3xl tracking-tight mb-4">Log In</h1>
        <p className="text-muted-foreground text-sm leading-6 mb-6">
          Magic-link login arrives in Phase 2.
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          For now: hit the API directly with a Bearer token from Supabase.
        </p>
      </div>
    </main>
  );
}
