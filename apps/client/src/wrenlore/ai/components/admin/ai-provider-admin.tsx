import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Grid,
  Group,
  Loader,
  MultiSelect,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconActivityHeartbeat,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import {
  useAiModelsQuery,
  useAiProviderHealthMutation,
  useAiProvidersQuery,
  useAiTaskRoutesQuery,
  useCreateAiModelMutation,
  useCreateAiProviderMutation,
  useDeleteAiModelMutation,
  useDeleteAiProviderMutation,
  useDiscoveredAiModelsQuery,
  useUpdateAiModelMutation,
  useUpdateAiProviderMutation,
  useUpsertAiTaskRoutesMutation,
} from "@/wrenlore/ai/queries/ai-admin-query";
import {
  AI_PROVIDER_TYPES,
  AI_TASK_CLASSES,
  AiModel,
  AiProvider,
  AiProviderHealthCheck,
  AiProviderHealthResponse,
  AiProviderType,
  AiTaskClass,
} from "@/wrenlore/ai/types/ai-admin.types";

const PROVIDER_TYPE_LABELS: Record<AiProviderType, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  "openai-compatible": "OpenAI-compatible",
};

const TASK_CLASS_LABELS: Record<AiTaskClass, string> = {
  "text-generation": "Text generation",
  "streaming-generation": "Streaming generation",
  "grounded-answer-generation": "Grounded answers",
  "embeddings-indexing-preparation": "Embeddings indexing",
};

const DEFAULT_BASE_URLS: Partial<Record<AiProviderType, string>> = {
  ollama: "http://127.0.0.1:11434",
  openai: "https://api.openai.com/v1",
};

interface ProviderFormState {
  id?: string;
  name: string;
  type: AiProviderType;
  baseUrl: string;
  apiKeyEnvVar: string;
  isEnabled: boolean;
}

interface ModelFormState {
  id?: string;
  providerId: string;
  name: string;
  modelId: string;
  isEnabled: boolean;
  defaultTaskClasses: AiTaskClass[];
}

function emptyProviderForm(type: AiProviderType = "ollama"): ProviderFormState {
  return {
    name: "",
    type,
    baseUrl: DEFAULT_BASE_URLS[type] ?? "",
    apiKeyEnvVar: type === "openai" ? "OPENAI_API_KEY" : "",
    isEnabled: true,
  };
}

function emptyModelForm(providerId = ""): ModelFormState {
  return {
    providerId,
    name: "",
    modelId: "",
    isEnabled: true,
    defaultTaskClasses: [],
  };
}

function taskClassOptions() {
  return AI_TASK_CLASSES.map((taskClass) => ({
    value: taskClass,
    label: TASK_CLASS_LABELS[taskClass],
  }));
}

function normalizeHealth(
  response: AiProviderHealthResponse,
): AiProviderHealthCheck[] {
  return "checks" in response ? response.checks : [response];
}

function optionalValue(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function providerLabel(provider: AiProvider) {
  return `${provider.name} (${PROVIDER_TYPE_LABELS[provider.type]})`;
}

function modelLabel(model: AiModel) {
  const provider = model.providerName ?? "Unknown provider";
  return `${model.name} (${model.modelId}) - ${provider}`;
}

export function AiProviderAdmin() {
  const providersQuery = useAiProvidersQuery();
  const modelsQuery = useAiModelsQuery();
  const routesQuery = useAiTaskRoutesQuery();
  const createProvider = useCreateAiProviderMutation();
  const updateProvider = useUpdateAiProviderMutation();
  const deleteProvider = useDeleteAiProviderMutation();
  const createModel = useCreateAiModelMutation();
  const updateModel = useUpdateAiModelMutation();
  const deleteModel = useDeleteAiModelMutation();
  const upsertRoutes = useUpsertAiTaskRoutesMutation();
  const healthMutation = useAiProviderHealthMutation();

  const providers = providersQuery.data ?? [];
  const models = modelsQuery.data ?? [];
  const routes = routesQuery.data ?? [];

  const [providerForm, setProviderForm] = useState<ProviderFormState>(() =>
    emptyProviderForm(),
  );
  const [modelForm, setModelForm] = useState<ModelFormState>(() =>
    emptyModelForm(),
  );
  const [routeAssignments, setRouteAssignments] = useState<
    Partial<Record<AiTaskClass, string>>
  >({});
  const [healthProviderId, setHealthProviderId] = useState<string | null>(null);
  const [healthModelId, setHealthModelId] = useState<string | null>(null);
  const [healthChecks, setHealthChecks] = useState<AiProviderHealthCheck[]>([]);
  const [selectedDiscoveredModel, setSelectedDiscoveredModel] = useState<
    string | null
  >(null);

  const discoveredModelsQuery = useDiscoveredAiModelsQuery(modelForm.providerId);

  useEffect(() => {
    if (!modelForm.providerId && providers.length > 0) {
      setModelForm((current) => ({
        ...current,
        providerId: providers[0].id,
      }));
    }
  }, [modelForm.providerId, providers]);

  useEffect(() => {
    const nextAssignments: Partial<Record<AiTaskClass, string>> = {};
    routes.forEach((route) => {
      nextAssignments[route.taskClass] = route.aiModelId;
    });
    setRouteAssignments(nextAssignments);
  }, [routes]);

  const providerOptions = providers.map((provider) => ({
    value: provider.id,
    label: providerLabel(provider),
  }));

  const enabledModelOptions = models
    .filter((model) => model.isEnabled)
    .map((model) => ({
      value: model.id,
      label: modelLabel(model),
    }));

  const healthModelOptions = useMemo(() => {
    return models
      .filter((model) => !healthProviderId || model.providerId === healthProviderId)
      .map((model) => ({
        value: model.id,
        label: modelLabel(model),
      }));
  }, [healthProviderId, models]);

  const discoveredModelOptions =
    discoveredModelsQuery.data?.models.map((model) => ({
      value: model.modelId,
      label: model.name === model.modelId ? model.modelId : `${model.name} (${model.modelId})`,
    })) ?? [];

  const discoveryError = discoveredModelsQuery.error
    ? ((discoveredModelsQuery.error as any)?.response?.data?.message ??
      discoveredModelsQuery.error.message)
    : null;

  function changeProviderType(type: AiProviderType) {
    setProviderForm((current) => ({
      ...current,
      type,
      baseUrl:
        !current.baseUrl ||
        Object.values(DEFAULT_BASE_URLS).includes(current.baseUrl)
          ? DEFAULT_BASE_URLS[type] ?? ""
          : current.baseUrl,
      apiKeyEnvVar:
        type === "openai" && !current.apiKeyEnvVar
          ? "OPENAI_API_KEY"
          : current.apiKeyEnvVar,
    }));
  }

  async function saveProvider() {
    if (!providerForm.name.trim()) {
      notifications.show({ message: "Provider name is required", color: "red" });
      return;
    }

    const payload = {
      name: providerForm.name.trim(),
      baseUrl: optionalValue(providerForm.baseUrl),
      apiKeyEnvVar: optionalValue(providerForm.apiKeyEnvVar),
      isEnabled: providerForm.isEnabled,
    };

    if (providerForm.id) {
      await updateProvider.mutateAsync({
        providerId: providerForm.id,
        ...payload,
      });
    } else {
      await createProvider.mutateAsync({
        type: providerForm.type,
        ...payload,
      });
    }
    setProviderForm(emptyProviderForm(providerForm.type));
  }

  function editProvider(provider: AiProvider) {
    setProviderForm({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl ?? "",
      apiKeyEnvVar: provider.apiKeyEnvVar ?? "",
      isEnabled: provider.isEnabled,
    });
  }

  function confirmDeleteProvider(provider: AiProvider) {
    modals.openConfirmModal({
      title: "Delete AI provider",
      children: (
        <Text size="sm">
          Delete {provider.name}? Models and routes using this provider may stop
          working.
        </Text>
      ),
      labels: { confirm: "Delete provider", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => deleteProvider.mutate(provider.id),
    });
  }

  async function saveModel() {
    if (!modelForm.providerId || !modelForm.name.trim() || !modelForm.modelId.trim()) {
      notifications.show({
        message: "Provider, model name, and model ID are required",
        color: "red",
      });
      return;
    }

    const payload = {
      name: modelForm.name.trim(),
      modelId: modelForm.modelId.trim(),
      isEnabled: modelForm.isEnabled,
      defaultTaskClasses: modelForm.defaultTaskClasses,
    };

    if (modelForm.id) {
      await updateModel.mutateAsync({
        aiModelId: modelForm.id,
        ...payload,
      });
    } else {
      await createModel.mutateAsync({
        providerId: modelForm.providerId,
        ...payload,
      });
    }
    setModelForm(emptyModelForm(modelForm.providerId));
    setSelectedDiscoveredModel(null);
  }

  function editModel(model: AiModel) {
    setModelForm({
      id: model.id,
      providerId: model.providerId,
      name: model.name,
      modelId: model.modelId,
      isEnabled: model.isEnabled,
      defaultTaskClasses: [],
    });
    setSelectedDiscoveredModel(null);
  }

  function selectDiscoveredModel(modelId: string | null) {
    setSelectedDiscoveredModel(modelId);
    const discovered = discoveredModelsQuery.data?.models.find(
      (model) => model.modelId === modelId,
    );
    if (!discovered) return;

    setModelForm((current) => ({
      ...current,
      name: discovered.name || discovered.modelId,
      modelId: discovered.modelId,
    }));
  }

  function confirmDeleteModel(model: AiModel) {
    modals.openConfirmModal({
      title: "Delete AI model",
      children: <Text size="sm">Delete {model.name}?</Text>,
      labels: { confirm: "Delete model", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => deleteModel.mutate(model.id),
    });
  }

  async function saveRoutes() {
    const missing = AI_TASK_CLASSES.filter((taskClass) => !routeAssignments[taskClass]);
    if (missing.length > 0) {
      notifications.show({
        message: "Select an enabled model for every task class",
        color: "red",
      });
      return;
    }

    await upsertRoutes.mutateAsync({
      routes: AI_TASK_CLASSES.map((taskClass) => ({
        taskClass,
        aiModelId: routeAssignments[taskClass] as string,
      })),
    });
  }

  async function runHealthCheck(params?: {
    providerId?: string;
    aiModelId?: string;
  }) {
    const response = await healthMutation.mutateAsync(params);
    setHealthChecks(normalizeHealth(response));
  }

  const loading =
    providersQuery.isLoading || modelsQuery.isLoading || routesQuery.isLoading;

  if (loading) {
    return (
      <Group gap="sm">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          Loading AI provider settings
        </Text>
      </Group>
    );
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600}>Providers</Text>
            <Text size="sm" c="dimmed">
              Configure provider endpoints and environment variable references.
            </Text>
          </div>
          <Button
            leftSection={<IconPlus size={16} />}
            variant="light"
            onClick={() => setProviderForm(emptyProviderForm(providerForm.type))}
          >
            New provider
          </Button>
        </Group>
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput
              label="Name"
              value={providerForm.name}
              onChange={(event) =>
                setProviderForm((current) => ({
                  ...current,
                  name: event.currentTarget.value,
                }))
              }
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <Select
              label="Type"
              data={AI_PROVIDER_TYPES.map((type) => ({
                value: type,
                label: PROVIDER_TYPE_LABELS[type],
              }))}
              value={providerForm.type}
              disabled={Boolean(providerForm.id)}
              onChange={(value) => changeProviderType(value as AiProviderType)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="Base URL"
              placeholder={DEFAULT_BASE_URLS[providerForm.type]}
              value={providerForm.baseUrl}
              onChange={(event) =>
                setProviderForm((current) => ({
                  ...current,
                  baseUrl: event.currentTarget.value,
                }))
              }
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <TextInput
              label="API key env var"
              placeholder="OPENAI_API_KEY"
              value={providerForm.apiKeyEnvVar}
              onChange={(event) =>
                setProviderForm((current) => ({
                  ...current,
                  apiKeyEnvVar: event.currentTarget.value,
                }))
              }
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <Switch
              label="Enabled"
              checked={providerForm.isEnabled}
              onChange={(event) =>
                setProviderForm((current) => ({
                  ...current,
                  isEnabled: event.currentTarget.checked,
                }))
              }
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <Button
              fullWidth
              onClick={saveProvider}
              loading={createProvider.isPending || updateProvider.isPending}
            >
              {providerForm.id ? "Update" : "Create"}
            </Button>
          </Grid.Col>
        </Grid>
        <Text size="xs" c="dimmed">
          Use environment variable names only. Raw API keys are not stored here.
        </Text>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Base URL</Table.Th>
                <Table.Th>API key env var</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {providers.map((provider) => (
                <Table.Tr key={provider.id}>
                  <Table.Td>{provider.name}</Table.Td>
                  <Table.Td>{PROVIDER_TYPE_LABELS[provider.type]}</Table.Td>
                  <Table.Td>{provider.baseUrl ?? "Default"}</Table.Td>
                  <Table.Td>{provider.apiKeyEnvVar ?? "None"}</Table.Td>
                  <Table.Td>
                    <Switch
                      size="sm"
                      checked={provider.isEnabled}
                      onChange={(event) =>
                        updateProvider.mutate({
                          providerId: provider.id,
                          isEnabled: event.currentTarget.checked,
                        })
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <ActionIcon
                        variant="subtle"
                        aria-label="Edit provider"
                        onClick={() => editProvider(provider)}
                      >
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label="Delete provider"
                        onClick={() => confirmDeleteProvider(provider)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>

      <Divider />

      <Stack gap="xs">
        <Text fw={600}>Models</Text>
        <Text size="sm" c="dimmed">
          Register model names and task defaults for the configured providers.
        </Text>
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Select
              label="Provider"
              data={providerOptions}
              value={modelForm.providerId || null}
              disabled={Boolean(modelForm.id)}
              onChange={(value) => {
                setSelectedDiscoveredModel(null);
                setModelForm((current) => ({
                  ...current,
                  providerId: value ?? "",
                }));
              }}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Select
              label="Discovered model"
              placeholder={
                discoveredModelsQuery.isLoading
                  ? "Loading provider models"
                  : discoveredModelOptions.length > 0
                    ? "Select a provider model"
                    : "No discovered models; manual entry remains available"
              }
              data={discoveredModelOptions}
              value={selectedDiscoveredModel}
              clearable
              searchable
              disabled={
                !modelForm.providerId ||
                discoveredModelsQuery.isLoading ||
                discoveredModelOptions.length === 0
              }
              rightSection={
                discoveredModelsQuery.isLoading ? <Loader size={14} /> : null
              }
              onChange={selectDiscoveredModel}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput
            label="Name"
            value={modelForm.name}
            onChange={(event) =>
              setModelForm((current) => ({
                ...current,
                name: event.currentTarget.value,
              }))
            }
          />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput
            label="Model ID"
            value={modelForm.modelId}
            onChange={(event) =>
              setModelForm((current) => ({
                ...current,
                modelId: event.currentTarget.value,
              }))
            }
          />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
          <MultiSelect
            label="Default tasks"
            data={taskClassOptions()}
            value={modelForm.defaultTaskClasses}
            onChange={(value) =>
              setModelForm((current) => ({
                ...current,
                defaultTaskClasses: value as AiTaskClass[],
              }))
            }
          />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
          <Switch
            label="Enabled"
            checked={modelForm.isEnabled}
            onChange={(event) =>
              setModelForm((current) => ({
                ...current,
                isEnabled: event.currentTarget.checked,
              }))
            }
          />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
          <Button
            fullWidth
            onClick={saveModel}
            disabled={providers.length === 0}
            loading={createModel.isPending || updateModel.isPending}
          >
            {modelForm.id ? "Update" : "Create"}
          </Button>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <Button
              fullWidth
              variant="light"
              onClick={() => discoveredModelsQuery.refetch()}
              disabled={!modelForm.providerId}
              loading={discoveredModelsQuery.isFetching}
            >
              Refresh discovered models
            </Button>
          </Grid.Col>
        </Grid>
        {discoveryError ? (
          <Alert color="yellow" variant="light">
            <Text size="sm">
              Model discovery failed: {discoveryError}. Manual model entry is
              still available.
            </Text>
          </Alert>
        ) : modelForm.providerId &&
          !discoveredModelsQuery.isLoading &&
          discoveredModelOptions.length === 0 ? (
          <Alert color="gray" variant="light">
            No models were discovered for this provider. You can still enter a
            model name and ID manually.
          </Alert>
        ) : null}
        {providers.length === 0 ? (
          <Alert color="gray" variant="light">
            Create a provider before adding models.
          </Alert>
        ) : null}
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Model ID</Table.Th>
                <Table.Th>Provider</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {models.map((model) => (
                <Table.Tr key={model.id}>
                  <Table.Td>{model.name}</Table.Td>
                  <Table.Td>{model.modelId}</Table.Td>
                  <Table.Td>{model.providerName ?? model.providerId}</Table.Td>
                  <Table.Td>
                    <Switch
                      size="sm"
                      checked={model.isEnabled}
                      onChange={(event) =>
                        updateModel.mutate({
                          aiModelId: model.id,
                          isEnabled: event.currentTarget.checked,
                        })
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <ActionIcon
                        variant="subtle"
                        aria-label="Edit model"
                        onClick={() => editModel(model)}
                      >
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label="Delete model"
                        onClick={() => confirmDeleteModel(model)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>

      <Divider />

      <Stack gap="xs">
        <Text fw={600}>Task routing</Text>
        <Text size="sm" c="dimmed">
          Choose the enabled model used by each WrenLore AI task class.
        </Text>
        {AI_TASK_CLASSES.map((taskClass) => (
          <Select
            key={taskClass}
            label={TASK_CLASS_LABELS[taskClass]}
            data={enabledModelOptions}
            value={routeAssignments[taskClass] ?? null}
            onChange={(value) =>
              setRouteAssignments((current) => ({
                ...current,
                [taskClass]: value ?? undefined,
              }))
            }
            disabled={enabledModelOptions.length === 0}
          />
        ))}
        <Group justify="flex-end">
          <Button
            onClick={saveRoutes}
            disabled={enabledModelOptions.length === 0}
            loading={upsertRoutes.isPending}
          >
            Save routes
          </Button>
        </Group>
      </Stack>

      <Divider />

      <Stack gap="xs">
        <Text fw={600}>Provider health</Text>
        <Text size="sm" c="dimmed">
          Check provider connectivity without exposing API key values.
        </Text>
        <Group align="flex-end">
          <Select
            label="Provider"
            data={providerOptions}
            value={healthProviderId}
            clearable
            onChange={(value) => {
              setHealthProviderId(value);
              setHealthModelId(null);
            }}
            style={{ flex: 1 }}
          />
          <Select
            label="Model"
            data={healthModelOptions}
            value={healthModelId}
            clearable
            onChange={setHealthModelId}
            style={{ flex: 1 }}
          />
          <Button
            leftSection={<IconActivityHeartbeat size={16} />}
            onClick={() =>
              runHealthCheck({
                providerId: healthProviderId ?? undefined,
                aiModelId: healthModelId ?? undefined,
              })
            }
            disabled={!healthProviderId && !healthModelId}
            loading={healthMutation.isPending}
          >
            Check selected
          </Button>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={() => runHealthCheck()}
            loading={healthMutation.isPending}
          >
            Check all
          </Button>
        </Group>
        {healthChecks.length > 0 ? (
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Provider</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Latency</Table.Th>
                  <Table.Th>Checked</Table.Th>
                  <Table.Th>Details</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {healthChecks.map((check) => (
                  <Table.Tr key={`${check.providerId}-${check.checkedAt}`}>
                    <Table.Td>{check.providerName}</Table.Td>
                    <Table.Td>
                      <Badge color={check.healthy ? "green" : "red"}>
                        {check.healthy ? "Healthy" : "Unhealthy"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{check.latencyMs} ms</Table.Td>
                    <Table.Td>{new Date(check.checkedAt).toLocaleString()}</Table.Td>
                    <Table.Td>
                      {check.error ? (
                        <Text size="sm" c="red">
                          {check.error}
                        </Text>
                      ) : check.details ? (
                        <Code block>{JSON.stringify(check.details, null, 2)}</Code>
                      ) : (
                        <Text size="sm" c="dimmed">
                          No details
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : null}
      </Stack>
    </Stack>
  );
}
