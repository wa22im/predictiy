import { z } from "zod";

const MarketInput = z.object({
  type: z.enum(["EXACT_SCORE", "OUTRIGHT_TEXT", "PROPOSITION_CHOICE"]),
  title: z.string().min(1),
  options: z.array(z.string()).optional(),
});

const MatchInput = z.object({
  apiMatchId: z.string().min(1),
  homeTeam: z.string().min(1),
  awayTeam: z.string().default(""),
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

export type CompetitionSyncPayload = z.infer<typeof CompetitionSyncInput>;
export type MatchPayload = z.infer<typeof MatchInput>;
export type MarketPayload = z.infer<typeof MarketInput>;
