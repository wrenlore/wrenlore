import { useCallback, useState } from "react";
import { ActionIcon, Button, Group, Textarea, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconTextCaption } from "@tabler/icons-react";
import { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Editor } from "@tiptap/core";
import { getAccessibilityDescriptionUpdate } from "@wrenlore/editor-ext";

type MediaDescriptionActionProps = {
  editor: Editor;
  nodeTypeName: string;
  description?: string;
  legacyAttributeNames?: string[];
};

export function MediaDescriptionAction({
  editor,
  nodeTypeName,
  description,
  legacyAttributeNames = [],
}: MediaDescriptionActionProps) {
  const { t } = useTranslation();

  const updateDescription = useCallback(
    (nextValue: string) => {
      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .updateAttributes(
          nodeTypeName,
          getAccessibilityDescriptionUpdate(nextValue, legacyAttributeNames),
        )
        .run();
    },
    [editor, legacyAttributeNames, nodeTypeName],
  );

  const openDescriptionModal = useCallback(() => {
    let modalId = "";
    modalId = modals.open({
      title: t("Accessibility description"),
      centered: true,
      children: (
        <MediaDescriptionModalContent
          t={t}
          initialValue={description || ""}
          onClose={() => modals.close(modalId)}
          onSave={(nextValue) => {
            updateDescription(nextValue);
            modals.close(modalId);
          }}
          onClear={() => {
            updateDescription("");
            modals.close(modalId);
          }}
        />
      ),
    });
  }, [description, t, updateDescription]);

  return (
    <Tooltip
      position="top"
      label={t("Accessibility description")}
      withinPortal={false}
    >
      <ActionIcon
        onClick={openDescriptionModal}
        size="lg"
        aria-label={t("Accessibility description")}
        variant="subtle"
      >
        <IconTextCaption size={18} />
      </ActionIcon>
    </Tooltip>
  );
}

function MediaDescriptionModalContent({
  t,
  initialValue,
  onClose,
  onSave,
  onClear,
}: {
  t: TFunction;
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => void;
  onClear: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <>
      <Textarea
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        autosize
        minRows={3}
        maxRows={6}
        autoFocus
        aria-label={t("Accessibility description")}
      />
      <Group justify="space-between" mt="md">
        <Button variant="subtle" color="red" onClick={onClear}>
          {t("Clear")}
        </Button>
        <Group gap="xs">
          <Button variant="default" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => onSave(value)}>{t("Save")}</Button>
        </Group>
      </Group>
    </>
  );
}
