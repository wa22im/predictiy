import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getInviteCookie } from "@/lib/invite-cookie";
import { SignupForm } from "@/components/auth/SignupForm";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string }>;
}) {
  const params = await searchParams;

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
        <p className="micro-label mb-3">Create Account</p>
        <h1 className="font-display text-4xl tracking-tight mb-2">
          Sign Up
        </h1>
        {invitedGroupName && (
          <p className="text-muted-foreground text-sm leading-6 mb-6">
            You&apos;ve been invited to join{" "}
            <span className="font-display text-foreground">
              {invitedGroupName}
            </span>
            ! Create an account to claim your spot.
          </p>
        )}
        {!invitedGroupName && (
          <p className="text-muted-foreground text-sm leading-6 mb-6">
            Choose an email and password. You&apos;ll pick a handle next.
          </p>
        )}

        <SignupForm />

        <p className="text-sm text-muted-foreground text-center mt-6">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-foreground underline underline-offset-2 hover:text-primary"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
