import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import {
  userAtom,
  workspaceAtom,
} from "@/features/user/atoms/current-user-atom";
import { getSpaces } from "@/features/space/services/space-service";
import SettingsTitle from "@/components/settings/settings-title";
import api from "@/lib/api-client";

interface AgentToken {
  id: string;
  name: string;
  agentName: string;
  access: "read" | "write";
  spaceIds: string[] | null;
  expiresAt: string | null;
  deletedAt: string | null;
  lastUsedAt: string | null;
}

export default function AgentConnections() {
  const user = useAtomValue(userAtom);
  const workspace = useAtomValue(workspaceAtom);
  const client = useQueryClient();
  const tokens = useQuery<AgentToken[]>({
    queryKey: ["agent-tokens", workspace?.id],
    queryFn: async () => (await api.get("/agent-tokens")).data,
  });
  const spaces = useInfiniteQuery({
    queryKey: ["agent-token-spaces", workspace?.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getSpaces({ limit: 100, cursor: pageParam }),
    getNextPageParam: (page) =>
      page.meta.hasNextPage ? (page.meta.nextCursor ?? undefined) : undefined,
  });
  const [name, setName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [access, setAccess] = useState<string | null>("read");
  const [scope, setScope] = useState<string | null>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [duration, setDuration] = useState<string | null>("90");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const enabled = workspace?.settings?.ai?.mcp === true;
  const url = `${window.location.origin}/mcp`;
  const config = JSON.stringify(
    {
      mcp: {
        servers: {
          wrenlore: {
            type: "remote",
            url,
            oauth: false,
            headers: { Authorization: "Bearer {env:WRENLORE_MCP_TOKEN}" },
          },
        },
      },
    },
    null,
    2,
  );

  function failure(error: any) {
    const message = error?.response?.data?.message;
    notifications.show({
      color: "red",
      message:
        typeof message === "string"
          ? message
          : "The connection could not be updated. Check the fields and try again.",
    });
  }
  async function create() {
    setBusy(true);
    try {
      const response = await api.post("/agent-tokens", {
        name,
        agentName,
        access,
        spaceIds: scope === "all" ? null : selected,
        expiresAt:
          duration === "never"
            ? null
            : new Date(Date.now() + Number(duration) * 86400000).toISOString(),
      });
      setSecret(response.data.token);
      setName("");
      setAgentName("");
      await client.invalidateQueries({ queryKey: ["agent-tokens"] });
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    try {
      await api.post(`/agent-tokens/${id}/revoke`);
      await client.invalidateQueries({ queryKey: ["agent-tokens"] });
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SettingsTitle title="Agent connections" />
      <Stack gap="md">
        <Text>
          Connect an AI agent to this workspace using your account. Changes
          appear as{" "}
          <strong>
            {user?.name ?? "You"}, via {agentName || "Agent"}
          </strong>
          . Your current page and space permissions always apply.
        </Text>
        {!enabled && (
          <Alert color="yellow">
            MCP is disabled. A workspace administrator can enable agent
            connections in AI settings. Existing tokens can still be revoked
            here.
          </Alert>
        )}
        <TextInput
          label="Connection name"
          placeholder="OpenCode on my laptop"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <TextInput
          label="Agent name"
          description="Shown on comments, document history and audit records."
          placeholder="Francis"
          maxLength={80}
          value={agentName}
          onChange={(e) => setAgentName(e.currentTarget.value)}
        />
        <Group grow>
          <Select
            label="Access"
            value={access}
            onChange={setAccess}
            allowDeselect={false}
            data={[
              { value: "read", label: "Read only" },
              { value: "write", label: "Read and write" },
            ]}
          />
          <Select
            label="Expires after"
            value={duration}
            onChange={setDuration}
            allowDeselect={false}
            data={[
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "never", label: "No expiry" },
            ]}
          />
        </Group>
        <Select
          label="Spaces"
          value={scope}
          onChange={setScope}
          allowDeselect={false}
          data={[
            { value: "all", label: "All spaces I can access" },
            { value: "selected", label: "Selected spaces" },
          ]}
        />
        {scope === "selected" && (
          <MultiSelect
            label="Allowed spaces"
            searchable
            maxValues={100}
            data={
              spaces.data?.pages
                .flatMap((page) => page.items)
                .map((s) => ({ value: s.id, label: s.name })) ?? []
            }
            value={selected}
            onChange={setSelected}
          />
        )}
        {scope === "selected" && spaces.hasNextPage && (
          <Button
            variant="subtle"
            loading={spaces.isFetchingNextPage}
            onClick={() => spaces.fetchNextPage()}
          >
            Load more spaces
          </Button>
        )}
        <Button
          onClick={create}
          loading={busy}
          disabled={
            !enabled ||
            !name.trim() ||
            !agentName.trim() ||
            (scope === "selected" && !selected.length)
          }
        >
          Create token
        </Button>
        {tokens.isError && (
          <Alert color="red">Could not load your connections.</Alert>
        )}
        <Table.ScrollContainer minWidth={650}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Connection</Table.Th>
                <Table.Th>Access</Table.Th>
                <Table.Th>Last used</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(tokens.data ?? []).map((token) => {
                const expired =
                  token.expiresAt && new Date(token.expiresAt) <= new Date();
                return (
                  <Table.Tr key={token.id}>
                    <Table.Td>
                      <Text>{token.name}</Text>
                      <Text size="xs" c="dimmed">
                        {user?.name}, via {token.agentName}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {token.access === "write" ? "Read/write" : "Read only"}
                      <Text size="xs">
                        {token.spaceIds
                          ? `${token.spaceIds.length} selected spaces`
                          : "Your accessible spaces"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {token.lastUsedAt
                        ? new Date(token.lastUsedAt).toLocaleString()
                        : "Not used yet"}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={token.deletedAt || expired ? "gray" : "green"}
                      >
                        {token.deletedAt
                          ? "Revoked"
                          : expired
                            ? "Expired"
                            : "Active"}
                      </Badge>
                      {token.expiresAt && (
                        <Text size="xs">
                          Expires{" "}
                          {new Date(token.expiresAt).toLocaleDateString()}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {!token.deletedAt && (
                        <Button
                          variant="subtle"
                          color="red"
                          disabled={busy}
                          onClick={() => revoke(token.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text fw={500}>Connect OpenCode</Text>
        <Text size="sm">
          Set WRENLORE_MCP_TOKEN in the environment where OpenCode runs, then
          add this MCP connection to its configuration.
        </Text>
        <Code block>{config}</Code>
        <CopyButton value={config}>
          {({ copied, copy }) => (
            <Button variant="light" onClick={copy}>
              {copied ? "Copied" : "Copy OpenCode configuration"}
            </Button>
          )}
        </CopyButton>
      </Stack>
      <Modal
        opened={secret !== null}
        onClose={() => setSecret(null)}
        title="Save your agent token"
      >
        <Stack>
          <Text>
            This token is shown once. Save it securely before closing this
            window.
          </Text>
          <Code
            block
            style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
          >
            {secret}
          </Code>
          <CopyButton value={secret ?? ""}>
            {({ copied, copy }) => (
              <Button onClick={copy}>{copied ? "Copied" : "Copy token"}</Button>
            )}
          </CopyButton>
          <Button variant="default" onClick={() => setSecret(null)}>
            Done
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
