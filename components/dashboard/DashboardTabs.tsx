"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Crown, Swords, UsersRound } from "lucide-react";
import { DashboardGroup, DashboardMatch } from "@/lib/services/dashboard";
import { MatchCard } from "@/components/matches/MatchCard";

interface DashboardTabsProps {
  groups: DashboardGroup[];
  serverNow: string;
  lockdownMs: number;
}

export function DashboardTabs({
  groups,
  serverNow,
  lockdownMs,
}: DashboardTabsProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const nextGroup = () => {
    setActiveIndex((prev) => (prev + 1) % groups.length);
  };

  const prevGroup = () => {
    setActiveIndex((prev) => (prev - 1 + groups.length) % groups.length);
  };

  const activeGroup = groups[activeIndex];

  if (!activeGroup) return null;

  return (
    <div className="space-y-6">
      {/* Tab Header / Navigation */}
      <div className="pitch-card-fut p-4 flex items-center justify-between">
        <button
          onClick={prevGroup}
          className="p-2 hover:bg-white/5 rounded-full transition-colors"
          aria-label="Previous pool"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <div className="flex flex-col items-center gap-1 text-center min-w-0">
          <Link
            href={`/groups/${activeGroup.id}`}
            className="group flex items-center gap-2 text-xl font-display font-bold hover:text-accent transition-colors"
          >
            <UsersRound
              aria-hidden="true"
              className="h-4 w-4 text-accent shrink-0"
            />
            <span className="group-hover:underline decoration-accent/50 underline-offset-4 truncate">
              {activeGroup.name}
            </span>
            <UsersRound
              aria-hidden="true"
              className="h-4 w-4 text-accent shrink-0"
            />
          </Link>
          <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Crown
            color="yellow"
              aria-hidden="true"
              className="h-3.5 w-3.5 text-accent shrink-0"
            />
            <span className="truncate">
              {activeGroup.competitionName} · {activeGroup.memberCount} members
            </span>
          </p>
        </div>

        <button
          onClick={nextGroup}
          className="p-2 hover:bg-white/5 rounded-full transition-colors"
          aria-label="Next group"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Matches List */}
        <div className="flex justify-center pt-4">
        <Link
          href={`/groups/${activeGroup.id}/matches`}
          className="text-sm font-medium text-accent hover:underline decoration-accent/30 underline-offset-4"
        >
          View all matches in {activeGroup.name} →
        </Link>
      </div>
      <div className="space-y-3 pitch-card-fut p-2">
        {activeGroup.matches.length > 0 ? (
          activeGroup.matches.map((match) => (
            <MatchCard
              key={`${activeGroup.id}-${match.id}`}
              match={match as any}
              groupId={activeGroup.id}
              serverNow={serverNow}
              lockdownMs={lockdownMs}
            />
          ))
        ) : (
          <div className="text-center py-12 pitch-card-hero">
            <p className="text-muted-foreground">No active matches for this group right now.</p>
          </div>
        )}
      </div>

      {/* View More Button */}
      <div className="flex justify-center pt-4">
        <Link
          href={`/groups/${activeGroup.id}/matches`}
          className="text-sm font-medium text-accent hover:underline decoration-accent/30 underline-offset-4"
        >
          View all matches in {activeGroup.name} →
        </Link>
      </div>

      {/* Group Index Indicator */}
      <div className="flex justify-center gap-1.5 pt-2">
        {groups.map((_, idx) => (
          <div
            key={idx}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              idx === activeIndex ? "w-6 bg-accent" : "w-1.5 bg-white/10"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
