import { isAddress } from "viem";
import type { Account } from "@/chrome/types";

export function isValidLocalVaultAddress(value: string): boolean {
  // Strict: a mixed-case paste must have a valid EIP-55 checksum (catches typos).
  return isAddress(value.trim());
}

/** Stores only the public address; the key stays in LocalVault. */
export function submitLocalVaultAccount(
  address: string,
  displayName: string,
): Promise<{ success: boolean; account?: Account; error?: string }> {
  if (!isValidLocalVaultAddress(address)) {
    return Promise.resolve({ success: false, error: "Paste the 0x address printed by LocalVault" });
  }
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "addLocalVaultAccount",
        address: address.trim(),
        displayName: displayName.trim() || undefined,
      },
      (response) => resolve(response ?? { success: false, error: "Failed to add account" }),
    );
  });
}
