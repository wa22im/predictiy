import Link from "next/link";

export default function AdminIndexPage() {
  const cards = [
    {
      href: "/admin/leagues",
      label: "External Sources",
      title: "League Roster",
      blurb:
        "Onboard tournaments from api-football.com. New games auto-appear in every group; cron syncs every 5 min.",
    },
    {
      href: "/admin/hydration",
      label: "Data Hydration",
      title: "Hydration Terminal",
      blurb:
        "Paste a competition JSON payload. Matches and markets are upserted in place.",
    },
    {
      href: "/admin/settlement",
      label: "Operational Control",
      title: "Settlement Hub",
      blurb:
        "Settle completed matches and outright markets. Scoring runs across every group.",
    },
    {
      href: "/admin/users",
      label: "Access Control",
      title: "User Roster",
      blurb:
        "Promote or revoke admin status. The DB trigger mirrors the flag to auth metadata.",
    },
  ];

  return (
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <p className="micro-label mb-3">Admin Console</p>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-2">
          Operations Room
        </h1>
        <p className="text-muted-foreground leading-7 mb-10">
          Backstage controls for the competition lifecycle.
        </p>

        <ul className="space-y-3">
          {cards.map((c) => (
            <li key={c.href}>
              <Link
                href={c.href}
                className="paper-card p-5 block hover:border-primary/50 transition-colors"
              >
                <p className="micro-label mb-1">{c.label}</p>
                <h2 className="font-display text-2xl font-bold tracking-tight mb-1">
                  {c.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-6">
                  {c.blurb}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
