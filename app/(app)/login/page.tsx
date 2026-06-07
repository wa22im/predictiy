import { LoginForm } from "@/components/auth/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string; redirect?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="planner-bg min-h-screen flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="glass-panel p-8 md:p-10 max-w-md w-full">
        <p className="micro-label mb-3">Sign In</p>
        <h1 className="font-display text-4xl tracking-tight mb-2">Log In</h1>
        {params.invited && (
          <p className="text-muted-foreground text-sm leading-6 mb-6">
            You&apos;ve been invited to a pool. Log in or sign up to claim your spot.
          </p>
        )}
        {!params.invited && (
          <p className="text-muted-foreground text-sm leading-6 mb-6">
            Enter your email and we&apos;ll send you a magic link to sign in.
          </p>
        )}

        <LoginForm redirect={params.redirect} initialError={params.error} />
      </div>
    </main>
  );
}
