// The app menu: the usual macOS/Windows/Linux menus (Edit makes copy and paste work in text fields,
// e.g. pasting the OpenAI key), developer tools only when not packaged, and Help with the log file.

import { Menu, shell } from "electron";

const REPO_URL = "https://github.com/Prestical/BreadPilot";

/** `actions`: openLog(), openDataFolder(). */
export function buildMenu({ isMac, dev, actions }) {
  const view = [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }];
  if (dev) view.unshift({ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" });
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : [{ label: "File", submenu: [{ role: "quit" }] }]),
    { role: "editMenu" },
    { label: "View", submenu: view },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Show Log File", click: actions.openLog },
        { label: "Show Data Folder", click: actions.openDataFolder },
        { type: "separator" },
        { label: "BreadPilot on GitHub", click: () => shell.openExternal(REPO_URL) },
        { label: "Report a Problem…", click: () => shell.openExternal(`${REPO_URL}/issues/new`) },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
