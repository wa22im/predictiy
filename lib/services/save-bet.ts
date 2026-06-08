/**
 * @deprecated This file's single-market `saveBet` flow has been
 * superseded by the multi-market batch save in
 * `lib/services/save-bets-batch.ts`. The per-market save endpoint at
 * `app/api/v1/bets/save/route.ts` now accepts a `picks` map and uses
 * `saveBetsBatch` under the hood. This file remains only as a
 * transitional re-export shim.
 */
import "server-only";

export {
  SaveBetError,
  validatePrediction,
} from "./save-bets-batch";
