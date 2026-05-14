import { Alert, Text } from "@mantine/core";

export function PlannedWrenLoreModule({ title }: { title: string }) {
  return (
    <Alert variant="light" color="gray">
      <Text fw={500}>{title}</Text>
      <Text size="sm">Planned WrenLore-native module.</Text>
    </Alert>
  );
}
