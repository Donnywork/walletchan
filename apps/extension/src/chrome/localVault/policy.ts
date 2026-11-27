/**
 * What a LocalVault account can send in M1: plain ETH transfers on Sepolia.
 * The same limits are enforced by the LocalVault program itself; checking
 * them here gives a clear message before the user copies anything.
 */
import type { PendingTxRequest } from "../requests/pendingTxStorage";

export const LOCAL_VAULT_CHAIN_ID = 11155111;

/** Returns why this pending transaction can't go through LocalVault, or null. */
export function localVaultUnsupportedReason(
  request: Pick<
    PendingTxRequest,
    | "tx"
    | "replacement"
    | "delegation7702Meta"
    | "erc7715PermissionRevokeMeta"
    | "privacyShieldMeta"
    | "privacyRagequitMeta"
    | "privacyUnshieldMeta"
    | "parentBundleId"
  >,
): string | null {
  const { tx } = request;
  if (request.replacement) {
    return "Speed-up and cancel are not supported for LocalVault accounts yet.";
  }
  if (
    request.delegation7702Meta ||
    request.erc7715PermissionRevokeMeta ||
    request.privacyShieldMeta ||
    request.privacyRagequitMeta ||
    request.privacyUnshieldMeta ||
    request.parentBundleId
  ) {
    return "LocalVault accounts can only send plain ETH transfers.";
  }
  if (tx.chainId !== LOCAL_VAULT_CHAIN_ID) {
    return "LocalVault accounts can only send on Sepolia for now.";
  }
  if (!tx.to || !/^0x[0-9a-fA-F]{40}$/.test(tx.to)) {
    return "LocalVault accounts can't deploy contracts.";
  }
  if (tx.data && tx.data !== "0x") {
    return "LocalVault accounts can only send plain ETH transfers, not contract calls or token transfers.";
  }
  return null;
}
