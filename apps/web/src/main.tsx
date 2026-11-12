import "./storageMigration";
import { applyTheme, watchSystemTheme } from "./ui/theme";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// The theme is set before the first paint, so a dark screen never flashes light.
applyTheme();
watchSystemTheme();

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
