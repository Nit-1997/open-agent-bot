import "./index.css";
import { historyRouter } from "@oab/ui/platform";
import { configureApi, createApiClient } from "@oab/ui/platform/api";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LocalApp } from "./LocalApp.tsx";
import { applyStoredTheme } from "./theme.ts";

const root = document.getElementById("root");
if (!root) throw new Error("Open Agent needs a #root element in index.html");

applyStoredTheme();
configureApi(createApiClient({ baseUrl: "/api" }));
createRoot(root).render(
  <StrictMode>
    <LocalApp router={historyRouter()} />
  </StrictMode>,
);
