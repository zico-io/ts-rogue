import { Box, Text, useApp, useInput } from "ink";
import type { IncidentDisplay } from "../../lib/incidents";
import { theme } from "../theme";

export function CrashScreen({ display }: { display: IncidentDisplay }) {
  const { exit } = useApp();
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) exit();
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.danger}
      paddingX={1}
    >
      <Text bold color={theme.danger}>
        Unexpected game failure
      </Text>
      <Text>{display.incident.message}</Text>
      <Text>Fingerprint: {display.incident.fingerprint}</Text>
      <Text>
        Report: {display.status}
        {display.detail ? ` (${display.detail})` : ""}
      </Text>
      <Text color={theme.textMuted}>
        The last valid game state was preserved. Press q or Ctrl+C to quit.
      </Text>
    </Box>
  );
}
