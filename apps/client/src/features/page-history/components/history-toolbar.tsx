import { ActionIcon, Group, Switch, Text } from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import { IconChevronUp, IconChevronDown } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { diffCountsAtom, highlightChangesAtom } from "../atoms/history-atoms";
import classes from "./css/history.module.css";

export default function HistoryToolbar({
  index,
  previous,
  next,
}: {
  index: number;
  previous: () => void;
  next: () => void;
}) {
  const { t } = useTranslation();
  const [highlight, setHighlight] = useAtom(highlightChangesAtom);
  const counts = useAtomValue(diffCountsAtom);
  return (
    <Group
      className={classes.toolbar}
      justify="center"
      gap="sm"
      aria-label={t("History controls")}
    >
      <Switch
        label={t("Highlight changes")}
        checked={highlight}
        onChange={(e) => setHighlight(e.currentTarget.checked)}
        styles={{ label: { userSelect: "none" } }}
      />
      {highlight && counts && counts.total > 0 && (
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {t("{{current}} of {{total}}", {
              current: index,
              total: counts.total,
            })}
          </Text>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={t("Previous change")}
            onClick={previous}
          >
            <IconChevronUp size={16} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={t("Next change")}
            onClick={next}
          >
            <IconChevronDown size={16} />
          </ActionIcon>
        </Group>
      )}
    </Group>
  );
}
