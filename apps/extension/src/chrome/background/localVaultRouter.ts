/** Trusted-wallet-UI transport for LocalVault accounts and copy-paste signing. */
import type { runPendingRequestResolution } from "../requests/pendingRequestResolution";

export const BACKGROUND_LOCAL_VAULT_MESSAGE_TYPES = [
  "addLocalVaultAccount",
  "prepareLocalVaultTransaction",
  "submitLocalVaultResponse",
] as const;

export type BackgroundLocalVaultRouteResult =
  | { handled: false }
  | { handled: true; keepChannelOpen: boolean };

export interface BackgroundLocalVaultDependencies {
  handleAddLocalVaultAccount(message: Record<string, unknown>): Promise<any>;
  handlePrepareLocalVaultTransaction(txId: string, gasOverrides?: any): Promise<any>;
  handleSubmitLocalVaultResponse(txId: string, response: unknown): Promise<any>;
  runPendingRequestResolution: typeof runPendingRequestResolution;
  pendingResolutionConflict: Parameters<typeof runPendingRequestResolution>[0]["conflictResult"];
}

const HANDLED_ASYNC: BackgroundLocalVaultRouteResult = { handled: true, keepChannelOpen: true };

export function createBackgroundLocalVaultMessageRouter(
  dependencies: BackgroundLocalVaultDependencies,
): (message: any, sendResponse: (response?: any) => void) => BackgroundLocalVaultRouteResult {
  return (message, sendResponse) => {
    const fail = (fallback: string) => (error: unknown) =>
      sendResponse({ success: false, error: error instanceof Error ? error.message : fallback });
    const txId = typeof message?.txId === "string" ? message.txId : "";
    switch (message?.type) {
      case "addLocalVaultAccount":
        void dependencies
          .handleAddLocalVaultAccount(message)
          .then((account) => sendResponse({ success: true, account }))
          .catch(fail("Failed to add account"));
        return HANDLED_ASYNC;
      case "prepareLocalVaultTransaction":
        void dependencies
          .handlePrepareLocalVaultTransaction(txId, message.gasOverrides)
          .then(sendResponse)
          .catch(fail("Failed to prepare LocalVault request"));
        return HANDLED_ASYNC;
      case "submitLocalVaultResponse":
        // Claims the pending request like other confirmations, so a
        // concurrent reject cannot race the broadcast.
        void dependencies
          .runPendingRequestResolution({
            family: "transaction",
            requestId: txId,
            action: "confirm",
            resolve: () => dependencies.handleSubmitLocalVaultResponse(txId, message.response),
            conflictResult: dependencies.pendingResolutionConflict,
          })
          .then(sendResponse)
          .catch(fail("Failed to submit LocalVault response"));
        return HANDLED_ASYNC;
      default:
        return { handled: false };
    }
  };
}
