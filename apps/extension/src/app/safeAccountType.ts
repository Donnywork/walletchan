import type { Account } from "@/chrome/types";

type LegacyAccountType = Exclude<Account["type"], "safe">;

export function toLegacyAccountType(type: Account["type"] | undefined): LegacyAccountType | undefined {
  return type === "safe" ? undefined : type;
}

/** LocalVault cannot batch (intake rejects it); show the reject-only view-only screen. */
export function toBatchAccountType(
  type: LegacyAccountType | undefined,
): Exclude<LegacyAccountType, "localVault"> | undefined {
  return type === "localVault" ? "impersonator" : type;
}
