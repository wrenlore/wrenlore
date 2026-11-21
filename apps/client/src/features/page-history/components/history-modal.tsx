import { Modal, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { historyAtoms } from "../atoms/history-atoms";
import HistoryModalBody from "./history-modal-body";
import HistoryModalMobile from "./history-modal-mobile";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@mantine/hooks";
import classes from "./css/history.module.css";

export default function HistoryModal({
  pageId,
  pageTitle,
}: {
  pageId: string;
  pageTitle?: string;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useAtom(historyAtoms);
  const mobile = useMediaQuery("(max-width: 800px)");
  return (
    <Modal.Root
      size={1400}
      opened={opened}
      onClose={() => setOpened(false)}
      fullScreen={mobile}
      classNames={{ content: classes.modalContent }}
      styles={{
        content: {
          height: mobile
            ? "100dvh"
            : "min(820px, calc(100dvh - 2 * var(--modal-y-offset)))",
        },
      }}
    >
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header style={{ flexShrink: 0 }}>
          <Modal.Title>
            <Text size="md" fw={500}>
              {t("Page history")}
            </Text>
          </Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body className={classes.modalBody} p={mobile ? 0 : undefined}>
          {mobile ? (
            <HistoryModalMobile pageId={pageId} pageTitle={pageTitle} />
          ) : (
            <HistoryModalBody pageId={pageId} />
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
