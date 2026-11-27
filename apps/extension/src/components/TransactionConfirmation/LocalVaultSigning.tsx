/**
 * Copy-paste signing for LocalVault accounts on the single-transaction
 * confirmation screen: the copy box, the paste box and the action button.
 * State lives in `useLocalVaultSigning`.
 */
import type { ReactNode } from "react";
import { Button, HStack, Text, Textarea, VStack } from "@chakra-ui/react";
import { ViewOnlySigningNotice } from "@/components/shared/ViewOnlySigningNotice";
import { shouldConfirmSimulationFailure } from "@/components/RequestConfirmation/simulationFailure";
import { useTheme } from "@/theme";
import { ConfirmActionButton } from "./ConfirmationActions";
import { CopyButton } from "./CopyButton";
import type { LocalVaultSigning } from "./useLocalVaultSigning";

/** `children` carries the shared review notices (e.g. asset preview unavailable). */
export function LocalVaultActionNotice({ signing, children }: { signing: LocalVaultSigning; children?: ReactNode }) {
  const { tokens } = useTheme();
  if (signing.unsupportedReason) {
    return <ViewOnlySigningNotice message={signing.unsupportedReason} />;
  }
  const fieldProps = {
    fontFamily: "mono",
    fontSize: "xs",
    resize: "vertical" as const,
    bg: "surface.raised",
    color: "fg.primary",
    border: tokens.borders.thin,
    borderColor: "border.default",
    borderRadius: tokens.radii.input,
    _placeholder: { color: "fg.muted" },
  };
  return (
    <VStack align="stretch" spacing={2}>
      {children}
      {!signing.envelope ? (
        <Text fontSize="sm" color="fg.secondary">
          Sign this in LocalVault. Confirm creates a request to copy into
          LocalVault; then paste its signed response here.
        </Text>
      ) : (
        <>
          <HStack justify="space-between">
            <Text fontSize="sm" fontWeight="700">1. Copy this request into LocalVault</Text>
            <HStack spacing={1}>
              <CopyButton label="Copy LocalVault request" value={signing.envelope} />
              <Button size="xs" variant="ghost" onClick={signing.edit} isDisabled={signing.busy !== null}>
                Edit
              </Button>
            </HStack>
          </HStack>
          <Textarea {...fieldProps} value={signing.envelope} isReadOnly rows={3}
            aria-label="LocalVault request" onFocus={(event) => event.target.select()} />
          <Text fontSize="sm" fontWeight="700">2. Paste the signed response</Text>
          <Textarea {...fieldProps} value={signing.response} rows={3}
            placeholder='{"v":1,"id":"…","result":{…}}' aria-label="LocalVault signed response"
            isDisabled={signing.busy !== null}
            onChange={(event) => signing.setResponse(event.target.value)} />
        </>
      )}
      {signing.error && (
        <Text role="alert" fontSize="xs" color="status.error.emphasis">{signing.error}</Text>
      )}
    </VStack>
  );
}

export function LocalVaultConfirmAction({
  signing,
  disabledReason,
  reviewLoading,
  simulationReverted,
}: {
  signing: LocalVaultSigning;
  disabledReason: string | null;
  reviewLoading: boolean;
  simulationReverted: boolean;
}) {
  if (!signing.envelope) {
    return (
      <ConfirmActionButton
        state={signing.busy === "preparing" ? "submitting" : "ready"}
        confirmDisabledReason={signing.unsupportedReason ?? disabledReason}
        simulationFailed={shouldConfirmSimulationFailure({ simulationReverted })}
        isReviewLoading={reviewLoading}
        label="Confirm"
        onConfirm={() => void signing.prepare()}
      />
    );
  }
  return (
    <Button
      variant="brand"
      w="full"
      onClick={() => void signing.submit()}
      isLoading={signing.busy === "submitting"}
      loadingText="Sending"
      isDisabled={!signing.response.trim()}
    >
      Send signed transaction
    </Button>
  );
}
