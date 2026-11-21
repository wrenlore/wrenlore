import { Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { HistoryStatus } from "../types/page.types";
export default function HistoryStatusNotice({
  status,
}: {
  status?: HistoryStatus;
}) {
  const { t } = useTranslation();
  return (
    <Text
      size="xs"
      c={status?.retrying ? "orange" : "dimmed"}
      py="xs"
      role="status"
    >
      {status?.retrying
        ? t(
            "Your page is saved. Its history snapshot is delayed and will be retried.",
          )
        : status?.pending
          ? t("Your page is saved. A history snapshot is pending.")
          : t("Edits are grouped into snapshots, usually within five minutes.")}
    </Text>
  );
}
