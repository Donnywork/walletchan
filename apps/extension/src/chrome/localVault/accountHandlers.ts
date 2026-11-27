/** Master-gated LocalVault account creation (public address only). */
import { addLocalVaultAccount } from "../accountStorage";
import { handleUnlockWallet } from "../authHandlers";
import { getAuthCeremonyEpoch } from "../authTransition";
import { resolvePasswordType } from "../sessionCache";
import {
  WALLET_SECRET_OPERATION_LOCK_KEY,
  withStorageLock,
} from "../storageLock";

export async function handleAddLocalVaultAccount(message: Record<string, unknown>) {
  const passwordType = await resolvePasswordType(handleUnlockWallet);
  if (passwordType !== "master") {
    throw new Error("Adding accounts requires master password");
  }
  const expectedAuthEpoch = getAuthCeremonyEpoch();
  if (typeof message.address !== "string") throw new Error("Invalid account address");
  const displayName =
    typeof message.displayName === "string" && message.displayName.trim()
      ? message.displayName.trim().slice(0, 64)
      : undefined;
  const account = await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, () =>
    addLocalVaultAccount(message.address as string, displayName, expectedAuthEpoch),
  );
  void chrome.runtime.sendMessage({ type: "accountsUpdated" }).catch(() => undefined);
  return account;
}
