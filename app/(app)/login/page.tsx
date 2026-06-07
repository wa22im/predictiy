import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getInviteCookie } from "@/lib/invite-cookie";
import { LoginForm } from "@/components/auth/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string; error?: string }>;
}) {
  const params = await searchParams;

  // If we got here via /join/[inviteCode], the cookie carries the code.
  const inviteCode = await getInviteCookie();
  let invitedGroupName: string | null = null;
  if (inviteCode) {
    const group = await prisma.group.findUnique({
      where: { inviteCode },
      select: { name: true },
    });
    invitedGroupName = group?.name ?? null;
  }

  return (
    <main className="planner-bg min-h-screen flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="glass-panel p-8 md:p-10 max-w-md w-full">
        <p className="micro-label mb-3">Sign In</p>
        <h1 className="font-display text-4xl tracking-tight mb-2">Log In</h1>
        {invitedGroupName && (
          <p className="text-muted-foreground text-sm leading-6 mb-6">
            You&apos;ve been invited to join{" "}
            <span className="font-display text-foreground">
              {invitedGroupName}
            </span>
            ! Log in to claim your spot.
          </p>
        )}
        {!invitedGroupName && (
          <p className="text-muted-foreground text-sm leading-6 mb-6">
            Welcome back. Sign in to your account.
          </p>
        )}

        <LoginForm initialError={params.error} />

        <p className="text-sm text-muted-foreground text-center mt-6">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-foreground underline underline-offset-2 hover:text-primary"
          >
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
