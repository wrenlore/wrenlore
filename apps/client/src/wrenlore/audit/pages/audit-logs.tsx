import { Alert, Button, Group } from "@mantine/core";
import { Helmet } from "react-helmet-async";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import { getAppName } from "@/lib/config";
import { useAuditLogs } from "@/wrenlore/audit/queries/audit-query";
import AuditLogsTable from "@/wrenlore/audit/components/audit-logs-table";
import { IAuditLogParams } from "@/wrenlore/audit/types/audit.types";

export default function AuditLogs() {
  const { t } = useTranslation();
  const [params] = useState<IAuditLogParams>({ limit: 50 });
  const { data, isLoading, isError, refetch } = useAuditLogs(params);

  return (
    <>
      <Helmet>
        <title>Audit log - {getAppName()}</title>
      </Helmet>
      <Group justify="space-between" mb="md">
        <SettingsTitle title={t("Audit log")} />
        <Button variant="default" size="xs" onClick={() => refetch()} loading={isLoading}>
          {t("Refresh")}
        </Button>
      </Group>
      {isError && (
        <Alert color="red" mb="md">
          {t("Unable to load audit log entries.")}
        </Alert>
      )}
      <AuditLogsTable items={data?.items ?? []} />
    </>
  );
}
