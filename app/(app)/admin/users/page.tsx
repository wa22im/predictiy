import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AdminUserRow } from "@/components/admin/AdminUserRow";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      nickname: true,
      emoji: true,
      isAdmin: true,
      createdAt: true,
      _count: { select: { memberships: true, bets: true } },
    },
  });

  return (
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <a
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
        >
          ← Back to admin
        </a>
        <p className="micro-label mb-2">Access Control</p>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-2">
          User Roster
        </h1>
        <p className="text-muted-foreground leading-7 mb-8">
          Promote or revoke admin status. The DB trigger mirrors the flag to
          auth metadata, so the change takes effect on the user's next
          request.
        </p>

        {users.length === 0 ? (
          <div className="glass-panel p-8 text-center">
            <p className="text-muted-foreground text-sm">No users yet.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => (
              <AdminUserRow
                key={u.id}
                user={{
                  id: u.id,
                  email: u.email,
                  nickname: u.nickname,
                  emoji: u.emoji,
                  isAdmin: u.isAdmin,
                  createdAt: u.createdAt.toISOString(),
                  groups: u._count.memberships,
                  bets: u._count.bets,
                }}
                isSelf={u.id === user.id}
              />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
