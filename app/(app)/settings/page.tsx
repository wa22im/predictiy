import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { PitchBg } from "@/components/football";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, nickname: true, emoji: true },
  });
  if (!dbUser) redirect("/login");

  return (
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 px-4 py-12">
        <div className="max-w-md mx-auto">
          <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-2">
            Settings
          </h1>
          <p className="text-muted-foreground text-sm leading-7 mb-8">
            Your nickname and emoji are visible to other players in your pools.
          </p>

          <SettingsForm
            initialNickname={dbUser.nickname}
            initialEmoji={dbUser.emoji}
            email={dbUser.email}
          />
        </div>
      </main>
    </PitchBg>
  );
}
