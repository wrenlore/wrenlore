import { Badge, Table, Text } from "@mantine/core";
import { formattedDate } from "@/lib/time";
import { IAuditLog } from "@/wrenlore/audit/types/audit.types";
import { getEventLabel } from "@/wrenlore/audit/lib/audit-event-labels";
import { getAuditAttribution } from "@/wrenlore/audit/lib/audit-attribution";

export default function AuditLogsTable({ items }: { items: IAuditLog[] }) {
  if (!items.length) {
    return <Text c="dimmed">No audit entries found.</Text>;
  }

  return (
    <Table.ScrollContainer minWidth={760}>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Event</Table.Th>
            <Table.Th>Actor</Table.Th>
            <Table.Th>Resource</Table.Th>
            <Table.Th>Created</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((item) => {
            const attribution = getAuditAttribution(item);
            return (
              <Table.Tr key={item.id}>
                <Table.Td>
                  <Badge variant="light">{getEventLabel(item.event)}</Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {attribution.actorLabel}
                    {attribution.viaAgentName &&
                      `, via ${attribution.viaAgentName}`}
                  </Text>
                  {attribution.managedAgentName && (
                    <Text size="xs" c="dimmed">
                      For agent: {attribution.managedAgentName}
                    </Text>
                  )}
                  {item.actor?.email && (
                    <Text size="xs" c="dimmed">
                      {item.actor.email}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{item.resourceType || "-"}</Text>
                  {item.resourceId && (
                    <Text size="xs" c="dimmed">
                      {item.resourceId}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{formattedDate(new Date(item.createdAt))}</Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
