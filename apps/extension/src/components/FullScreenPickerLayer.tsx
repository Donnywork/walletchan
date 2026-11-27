import { Box, Portal, type BoxProps } from "@chakra-ui/react";
import { useEffect, type ReactNode } from "react";

interface FullScreenPickerLayerProps extends BoxProps {
  children: ReactNode;
}

/**
 * Portals a nested picker above the current app screen and makes the covered
 * application tree inert while the picker is active.
 */
export function FullScreenPickerLayer({
  children,
  ...rest
}: FullScreenPickerLayerProps) {
  useEffect(() => {
    const appRoot =
      document.getElementById("root") ??
      document.getElementById("preview-root");
    if (!appRoot) return;

    // Native inert also removes the covered screen from the accessibility tree.
    const wasInert = appRoot.inert;
    appRoot.inert = true;

    return () => {
      if (!wasInert) appRoot.inert = false;
    };
  }, []);

  return (
    <Portal>
      <Box
        position="fixed"
        inset={0}
        zIndex="modal"
        bg="surface.base"
        {...rest}
      >
        {children}
      </Box>
    </Portal>
  );
}
