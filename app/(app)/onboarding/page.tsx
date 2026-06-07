import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { OnboardingForm } from "@/components/auth/OnboardingForm";

const EMOJI_OPTIONS = [
  "⚽", "🍕", "⚡", "🐉", "🎯",
  "🦄", "🔥", "💎", "🌊", "🍿",
] as const;

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Pre-fill if returning user has partial data
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { nickname: true, emoji: true },
  });

  return (
    <main className="planner-bg min-h-screen flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="glass-panel p-8 md:p-10 max-w-md w-full">
        <p className="micro-label mb-3">Profile</p>
        <h1 className="font-display text-4xl tracking-tight mb-2">
          Pick your handle
        </h1>
        <p className="text-muted-foreground text-sm leading-6 mb-6">
          Your nickname and emoji will be visible to others in your pools.
        </p>

        <OnboardingForm
          initialNickname={dbUser?.nickname ?? ""}
          initialEmoji={dbUser?.emoji ?? "⚽"}
          emojis={[...EMOJI_OPTIONS]}
        />
      </div>
    </main>
  );
}
