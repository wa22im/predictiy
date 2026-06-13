"use client";

import type { FeedOtherBet } from "@/lib/services/group-feed";
import { CrestSlot } from "@/components/football/crest-slot";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export function MemberPredictions({
  otherBets,
}: {
  otherBets: FeedOtherBet[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (otherBets.length === 0) return null;

  const MAX_VISIBLE = 3;
  const isLongList = otherBets.length > MAX_VISIBLE;
  const visibleBets = isExpanded ? otherBets : otherBets.slice(0, MAX_VISIBLE);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="micro-tag">Others</span>
        {isLongList && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
          >
            {isExpanded ? (
              <span className="micro-tag">
                Show less <ChevronUp className="h-3 w-3" />
              </span>
            ) : (
              <span className="micro-tag">
                Show all ({otherBets.length}) <ChevronDown className="h-3 w-3" />
              </span>
            )}
          </button>
        )}
      </div>
      
      <div className={`flex flex-wrap items-center gap-2 text-xs ${isExpanded ? "" : "max-h-10 overflow-hidden"}`}>
        {visibleBets.map((b) => (
          <span
            key={b.userId}
            className="inline-flex items-center gap-1.5 font-mono bg-background/40 border border-border rounded-full pl-1 pr-2 py-0.5"
          >
            <CrestSlot name={b.nickname} size="sm" />
            <span>
              {b.emoji} {b.nickname}:{" "}
              <span className={b.isMasked ? "text-muted-foreground" : ""}>
                {b.predictedValue}
              </span>
              

              

              
            </span>
          </span>
        ))}
        {isLongList && !isExpanded && (
           <span className="text-muted-foreground italic">... and {otherBets.length - MAX_VISIBLE} more</span>
        )}
      </div>
    </div>
  );
}
