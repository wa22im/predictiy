/**
 * Ingest a competition from fixturedownload.com.
 *
 * One-shot ingestion — the feed is schedule-only, with no live status
 * or scores, so we don't sync from it. Use api-football for live
 * data once a competition is in progress.
 *
 * Filters:
 *   - maxRound: only ingest matches with RoundNumber <= maxRound
 *     (default 3 — group stage). Use Infinity to ingest everything.
 *   - skip placeholders: matches with placeholder team names
 *     ("2A", "To be announced") are dropped.
 *
 * For each match we create the same three default markets the
 * api-football pipeline creates (EXACT_SCORE, HALF_SCORING, and
 * IN_GAME_PENALTY — all on every match, no stage gating). The
 * "correct winner" credit is folded into EXACT_SCORE's scoring.
 *   - EXACT_SCORE      "Predict the final score"
 *   - HALF_SCORING     "Which teams score in which half?"
 *   - IN_GAME_PENALTY  "Which team gets an in-game penalty?"
 *
 * Stage mapping from RoundNumber:
 *   1, 2, 3  →  GROUP_STAGE
 *   4+       →  KNOCKOUT
 */

import { prisma } from "@/lib/prisma";
import {
  fetchFixtures,
  isPlaceholderTeam,
  parseDateUtc,
  type FixturedownloadMatch,
} from "@/lib/services/fixturedownload";

export type IngestFromFixtureDownloadInput = {
  /** Competition display name, e.g. "FIFA World Cup 2026" */
  name: string;
  /** Feed slug, e.g. "fifa-world-cup-2026" */
  slug: string;
  /** Year to record in Competition.externalSeason */
  season: number;
  /** Only ingest matches with RoundNumber <= this. Default 3 (group stage). */
  maxRound?: number;
};

export type IngestFromFixtureDownloadResult = {
  competitionId: string;
  created: { competition: boolean; matches: number; markets: number };
  updated: { matches: number };
  skipped: { placeholders: number; aboveMaxRound: number };
  total: number;
};

const HALF_SCORING_OPTIONS = ["A_1H", "A_2H", "B_1H", "B_2H"];
const IN_GAME_PENALTY_OPTIONS = ["HOME", "AWAY"];

export async function ingestFromFixtureDownload(
  input: IngestFromFixtureDownloadInput,
): Promise<IngestFromFixtureDownloadResult> {
  const maxRound = input.maxRound ?? 3;
  const matches = await fetchFixtures(input.slug);

  // Filter to "real" matches we want to ingest.
  const real = matches.filter((m) => {
    if (m.RoundNumber > maxRound) return false;
    if (isPlaceholderTeam(m.HomeTeam)) return false;
    if (isPlaceholderTeam(m.AwayTeam)) return false;
    return true;
  });

  const skipped = {
    placeholders: matches.filter((m) => isPlaceholderTeam(m.HomeTeam) || isPlaceholderTeam(m.AwayTeam)).length,
    aboveMaxRound: matches.filter((m) => m.RoundNumber > maxRound).length,
  };

  // fixturedownload.com doesn't expose a tournament end-date, so
  // derive one from the latest real match's kickoffTime. The
  // dashboard's active-competition filter (`!endDate || endDate >
  // now`) treats a populated endDate as "tournament finished" — for
  // an upcoming tournament with no matches played yet the max
  // kickoffTime is the final, and once that moment passes the group
  // drops off the dashboard. If `real` is empty (e.g. all matches
  // were placeholders) we leave endDate undefined.
  const lastKickoff = real.reduce<Date | null>(
    (acc, m) => {
      const d = parseDateUtc(m.DateUtc);
      if (!acc || d.getTime() > acc.getTime()) return d;
      return acc;
    },
    null,
  );
  const endDate = lastKickoff ?? undefined;

  // Upsert the competition. externalLeagueId is null for this source
  // (the feed has no numeric league id). lastSyncedAt is set so
  // future api-football ingests can co-exist on the same competition
  // if desired.
  const existing = await prisma.competition.findUnique({
    where: { name: input.name },
    select: { id: true },
  });
  const competition = await prisma.competition.upsert({
    where: { name: input.name },
    create: {
      name: input.name,
      externalSource: "fixturedownload",
      externalLeagueId: null,
      externalSeason: input.season,
      ...(endDate ? { endDate } : {}),
    },
    update: {
      externalSource: "fixturedownload",
      externalSeason: input.season,
      ...(endDate ? { endDate } : {}),
    },
  });

  let matchesCreated = 0;
  let matchesUpdated = 0;
  let marketsCreated = 0;

  for (const m of real) {
    const existed = await prisma.match.findUnique({
      where: { apiMatchId: `fd-${m.MatchNumber}` },
      select: { id: true },
    });
    const match = await upsertMatch(competition.id, m);
    if (existed) matchesUpdated += 1;
    else matchesCreated += 1;

    const exactExisted = await prisma.betMarket.findUnique({
      where: { matchId_type_title: { matchId: match.id, type: "EXACT_SCORE", title: "Predict the final score" } },
      select: { id: true },
    });
    await upsertMarket(match.id, "EXACT_SCORE", "Predict the final score", null);
    if (!exactExisted) marketsCreated += 1;

    const halfExisted = await prisma.betMarket.findUnique({
      where: { matchId_type_title: { matchId: match.id, type: "HALF_SCORING", title: "Which teams score in which half?" } },
      select: { id: true },
    });
    await upsertMarket(match.id, "HALF_SCORING", "Which teams score in which half?", HALF_SCORING_OPTIONS);
    if (!halfExisted) marketsCreated += 1;

    const penaltyExisted = await prisma.betMarket.findUnique({
      where: { matchId_type_title: { matchId: match.id, type: "IN_GAME_PENALTY", title: "Which team gets an in-game penalty?" } },
      select: { id: true },
    });
    await upsertMarket(match.id, "IN_GAME_PENALTY", "Which team gets an in-game penalty?", IN_GAME_PENALTY_OPTIONS);
    if (!penaltyExisted) marketsCreated += 1;
  }

  return {
    competitionId: competition.id,
    created: {
      competition: !existing,
      matches: matchesCreated,
      markets: marketsCreated,
    },
    updated: {
      matches: matchesUpdated,
    },
    skipped,
    total: matches.length,
  };
}

async function upsertMatch(competitionId: string, m: FixturedownloadMatch) {
  const stage = m.RoundNumber <= 3 ? "GROUP_STAGE" : "KNOCKOUT";
  // Prefix apiMatchId with "fd-" to avoid collisions with api-football ids
  // and to make the source obvious in the DB.
  return prisma.match.upsert({
    where: { apiMatchId: `fd-${m.MatchNumber}` },
    create: {
      apiMatchId: `fd-${m.MatchNumber}`,
      competitionId,
      homeTeam: m.HomeTeam.trim(),
      awayTeam: m.AwayTeam.trim(),
      kickoffTime: parseDateUtc(m.DateUtc),
      stage,
      status: "SCHEDULED",
    },
    update: {
      homeTeam: m.HomeTeam.trim(),
      awayTeam: m.AwayTeam.trim(),
      kickoffTime: parseDateUtc(m.DateUtc),
      stage,
      // Don't downgrade a finished match back to SCHEDULED — once
      // settled, stay settled.
    },
  });
}

async function upsertMarket(
  matchId: string,
  type: string,
  title: string,
  options: string[] | null,
) {
  return prisma.betMarket.upsert({
    where: { matchId_type_title: { matchId, type, title } },
    create: { matchId, type, title, options: options ?? undefined },
    update: options ? { options } : {},
  });
}
