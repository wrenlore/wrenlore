import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router";
import { useSetAtom } from "jotai";
import { MantineProvider, Button } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import "@mantine/core/styles.css";
import { queryClient } from "./query";
import { theme, mantineCssResolver } from "../../apps/client/src/theme";
import { historyAtoms } from "../../apps/client/src/features/page-history/atoms/history-atoms";
import HistoryModal from "../../apps/client/src/features/page-history/components/history-modal";
function App() {
  const open = useSetAtom(historyAtoms);
  return (
    <>
      <Button onClick={() => open(true)}>Open history</Button>
      <HistoryModal pageId="synthetic-page" />
    </>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <MantineProvider theme={theme} cssVariablesResolver={mantineCssResolver}>
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  </MantineProvider>,
);
