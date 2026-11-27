/**
 * Copy-paste signing for LocalVault accounts on the single-transaction
 * confirmation screen: the copy box, the paste box and the action button.
 * State lives in `useLocalVaultSigning`.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Button, Heading, HStack, Text, Textarea, VStack } from "@chakra-ui/react";
import { ViewOnlySigningNotice } from "@/components/shared/ViewOnlySigningNotice";
import { shouldConfirmSimulationFailure } from "@/components/RequestConfirmation/simulationFailure";
import { useTheme } from "@/theme";
import { ConfirmActionButton } from "./ConfirmationActions";
import { CopyButton } from "./CopyButton";
import type { LocalVaultSigning } from "./useLocalVaultSigning";

const stepHeadingProps = {
  as: "h2",
  fontFamily: "body",
  fontSize: "sm",
  fontWeight: "semibold",
  lineHeight: "short",
} as const;

/** `children` carries the shared review notices (e.g. asset preview unavailable). */
export function LocalVaultActionNotice({ signing, children }: { signing: LocalVaultSigning; children?: ReactNode }) {
  const { tokens } = useTheme();
  const requestHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (signing.envelope) {
      requestHeading.current?.focus({ preventScroll: true });
      requestHeading.current?.scrollIntoView({ block: "start" });
    }
  }, [signing.envelope]);
  if (signing.unsupportedReason) {
    return <ViewOnlySigningNotice message={signing.unsupportedReason} />;
  }
  const fieldProps = {
    fontFamily: "body",
    fontSize: "sm",
    resize: "vertical" as const,
    bg: "surface.sunken",
    color: "fg.primary",
    border: tokens.borders.thin,
    borderColor: "border.default",
    borderRadius: tokens.radii.input,
    _placeholder: { color: "fg.muted" },
  };
  return (
    <VStack as="section" aria-label="LocalVault signing" align="stretch" spacing={3}
      bg="surface.raised" border={tokens.borders.thin} borderColor="border.default"
      borderRadius={tokens.radii.modal} p={4}>
      {children}
      {!signing.envelope ? (
        <Text fontSize="sm" color="fg.secondary">
          Sign this in LocalVault. Confirm creates a request to copy into
          LocalVault; then paste its signed response here.
        </Text>
      ) : (
        <>
          <HStack justify="space-between" flexWrap="wrap" rowGap={1}>
            <Heading {...stepHeadingProps} flex="1 1 13rem" ref={requestHeading} tabIndex={-1} scrollMarginTop={5}>
              1. Copy this request into LocalVault
            </Heading>
            <HStack spacing={1}>
              <CopyButton label="Copy LocalVault request" value={signing.envelope} />
              <Button size="xs" variant="ghost" onClick={signing.edit} isDisabled={signing.busy !== null}>
                Edit
              </Button>
            </HStack>
          </HStack>
          <Textarea {...fieldProps} value={signing.envelope} isReadOnly rows={3}
            aria-label="LocalVault request" onFocus={(event) => event.target.select()} />
          <Heading {...stepHeadingProps}>2. Paste the signed response</Heading>
          <Textarea {...fieldProps} value={signing.response} rows={4}
            placeholder="Paste the response from LocalVault" aria-label="LocalVault signed response"
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
      variant="secondary"
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
