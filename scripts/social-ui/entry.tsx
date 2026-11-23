import React from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { MfaChallengePage } from "../../apps/client/src/wrenlore/mfa/pages";
import { ConnectedAccounts } from "../../apps/client/src/features/user/components/connected-accounts";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
i18n
  .use(initReactI18next)
  .init({
    lng: "en-US",
    fallbackLng: "en-US",
    resources: { "en-US": { translation: {} } },
    interpolation: { escapeValue: false },
  });
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider>
      <Notifications />
      <QueryClientProvider client={new QueryClient()}>
        <BrowserRouter>
          <Routes>
            <Route path="/login/mfa" element={<MfaChallengePage />} />
            <Route path="/login" element={<p>LOGIN FALLBACK</p>} />
            <Route path="/home" element={<p>AUTHENTICATED HOME</p>} />
            <Route path="/settings/account" element={<ConnectedAccounts />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
);
