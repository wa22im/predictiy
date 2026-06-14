"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/supabase/server";
import {
  leaveGroup,
  renameGroup,
  type LeaveGroupResult,
  type RenameGroupResult,
} from "@/lib/services/groups";

/**
 * Server actions for the /groups/* tree.
 *
 * The action layer is intentionally thin: it does the auth check
 * (which requires `next/headers` cookies — only available on the
 * server), calls into the service layer, and revalidates the cache
 * for the affected routes. Business logic (permission checks, the
 * empty-group cascade) lives in lib/services/groups.ts so it can be
 * shared with the API routes and tested in isolation.
 *
 * Return shapes intentionally mirror the underlying service result so
 * UI callers can switch on `ok` and pull the right field out without
 * re-mapping.
 */

export type LeaveGroupActionResult =
  | (LeaveGroupResult & { ok: true })
  | { ok: false; error: "NOT_AUTHENTICATED" | "NOT_A_MEMBER" };

export async function leaveGroupAction(
  groupId: string,
): Promise<LeaveGroupActionResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "NOT_AUTHENTICATED" };

  const result = await leaveGroup({ groupId, callerId: user.id });

  if (result.ok) {
    // Both routes may have stale cached data after a leave:
    //  - /dashboard lists the user's groups and just lost one row
    //  - /groups/[id] either shows a 404 (group deleted) or the new
    //    membership count
    revalidatePath("/dashboard");
    revalidatePath(`/groups/${groupId}`);
  }

  return result;
}

export type RenameGroupActionResult =
  | (RenameGroupResult & { ok: true })
  | { ok: false; error: "NOT_AUTHENTICATED" | string; status?: number };

export async function renameGroupAction(
  groupId: string,
  newName: string,
): Promise<RenameGroupActionResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "NOT_AUTHENTICATED" };

  // The service already calls revalidatePath for /groups/[id] and
  // /groups (so the listing and the detail page both refresh). We
  // additionally revalidate /dashboard because the dashboard's group
  // cards display the group's name.
  const result = await renameGroup({
    groupId,
    callerId: user.id,
    newName,
  });

  if (result.ok) {
    revalidatePath("/dashboard");
  }

  return result;
}
