import { z } from "zod";

const MarketInput = z.object({
  type: z.enum([
    "EXACT_SCORE",
    "OUTRIGHT_TEXT",
    "PROPOSITION_CHOICE",
    "HALF_SCORING",
    "IN_GAME_PENALTY",
  ]),
  title: z.string().min(1),
  options: z.array(z.string()).optional(),
});

const MatchInput = z.object({
  apiMatchId: z.string().min(1),
  homeTeam: z.string().min(1),
  awayTeam: z.string().default(""),
  homeCrest: z.string().url().optional(),
  awayCrest: z.string().url().optional(),
  kickoffTime: z
    .string()
    .datetime({ message: "kickoffTime must be ISO 8601 UTC" }),
  stage: z.string().min(1),
  markets: z.array(MarketInput).default([]),
});

export const CompetitionSyncInput = z.object({
  competition: z.object({
    name: z.string().min(1),
  }),
  matches: z.array(MatchInput).min(1),
});

/**
 * POST /api/v1/admin/competitions — body for creating a custom
 * (hand-built) tournament. The competition is born with
 * `externalSource = null` so the cron never auto-syncs it. The name
 * must be unique (the schema enforces a `@unique` constraint and the
 * route surfaces the failure as a 400 `NAME_TAKEN`).
 *
 * `endDate` is REQUIRED because the DB enforces a CHECK constraint
 * (`endDate_required_for_custom`): if `externalSource IS NULL` (custom
 * tournament), `endDate` must be non-null. The same rule is enforced
 * here so the API returns a clean 400 VALIDATION response before the
 * insert hits the DB constraint. See
 * `prisma/init.sql` and `app/api/v1/admin/competitions/route.ts`.
 */
export const CreateCustomCompetitionInput = z.object({
  name: z.string().min(1).max(120),
  endDate: z.string().datetime(),
});

/**
 * POST /api/v1/admin/competitions/[id]/matches — body for adding
 * matches to a custom tournament. `matchIds` references Match.id
 * (NOT apiMatchId) — the join table key is the internal UUID. Capped
 * at 100 per request to keep the createMany call cheap.
 */
export const AddMatchesInput = z.object({
  matchIds: z.array(z.string().min(1)).min(1).max(100),
});

export type CompetitionSyncPayload = z.infer<typeof CompetitionSyncInput>;
export type MatchPayload = z.infer<typeof MatchInput>;
export type MarketPayload = z.infer<typeof MarketInput>;
export type CreateCustomCompetitionPayload = z.infer<typeof CreateCustomCompetitionInput>;
export type AddMatchesPayload = z.infer<typeof AddMatchesInput>;
