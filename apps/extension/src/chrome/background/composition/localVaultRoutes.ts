/** LocalVault account and copy-paste signing route wiring. */

import { handleAddLocalVaultAccount } from "../../localVault/accountHandlers";
import {
  handlePrepareLocalVaultTransaction,
  handleSubmitLocalVaultResponse,
} from "../../localVault/transactionExecution";
import { createBackgroundLocalVaultMessageRouter } from "../localVaultRouter";
import type { PendingResolutionComposition } from "./pendingResolution";

export function composeLocalVaultRoutes(pending: PendingResolutionComposition) {
  return {
    routeBackgroundLocalVaultMessage: createBackgroundLocalVaultMessageRouter({
      handleAddLocalVaultAccount,
      handlePrepareLocalVaultTransaction,
      handleSubmitLocalVaultResponse,
      runPendingRequestResolution: pending.runPendingRequestResolution,
      pendingResolutionConflict: pending.pendingResolutionConflict,
    }),
  };
}
