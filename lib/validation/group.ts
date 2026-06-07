import { z } from "zod";

export const CreateGroupInput = z.object({
  name: z.string().min(1).max(80),
  competitionId: z.string().uuid(),
});

export type CreateGroupPayload = z.infer<typeof CreateGroupInput>;
