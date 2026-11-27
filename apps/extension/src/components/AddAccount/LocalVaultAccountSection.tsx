import { Box, FormControl, FormErrorMessage, Input, Text, VStack } from "@chakra-ui/react";
import { ScreenSection } from "@/components/ui";

export function LocalVaultAccountSection({
  address,
  onAddressChange,
  error,
}: {
  address: string;
  onAddressChange: (value: string) => void;
  error?: string;
}) {
  return (
    <VStack align="stretch" spacing={4}>
      <ScreenSection
        title="LocalVault address"
        description="The public address your LocalVault account uses"
      >
        <FormControl isInvalid={!!error}>
          <Input
            aria-label="LocalVault address"
            placeholder="0x…"
            fontFamily="mono"
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
          />
          <FormErrorMessage color="chart.negative" fontWeight="700">
            {error}
          </FormErrorMessage>
        </FormControl>
      </ScreenSection>
      <Box
        p={3}
        bg="status.info.bg"
        border="1px solid"
        borderColor="status.info.border"
        borderRadius="md"
      >
        <Text fontSize="sm" color="status.info.fg" fontWeight="600">
          WalletChan stores only this address. You approve and sign each
          transaction in LocalVault, moving the request and response by copy
          and paste. Only Sepolia ETH transfers are supported for now.
        </Text>
      </Box>
    </VStack>
  );
}
