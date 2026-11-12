import logo from "../assets/logo.png";
import { DEMOS } from "../demos";
import { STATE_LABEL } from "../projects/progress";
import { useApp } from "../store";

/** GitHub's mark (Octicons "mark-github", MIT licence), in the text colour. */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

/** Left column: new project, tutorial, your projects, examples, system status. */
export function Sidebar() {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const source = useApp((s) => s.source);
  const list = useApp((s) => s.agent.list);
  const listState = useApp((s) => s.agent.listState);
  const refreshList = useApp((s) => s.refreshList);
  const busy = useApp((s) => s.agent.busy);
  const openProject = useApp((s) => s.openProject);
  const removeProject = useApp((s) => s.removeProject);
  const openDemo = useApp((s) => s.openDemo);
  const newProject = useApp((s) => s.newProject);
  const open = useApp((s) => s.sidebarOpen);
  const setOpen = useApp((s) => s.setSidebarOpen);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const setPartsOpen = useApp((s) => s.setPartsOpen);
  const building = mode === "build";

  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="Projects">
      <div className="brand">
        <img className="logo" src={logo} alt="" width={30} height={30} />
        <span>BreadPilot</span>
        <span className="board-chip">Pico 2 W</span>
        <button type="button" className="icon-btn drawer-close" aria-label="Close the project list" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>

      <nav className="side-nav" aria-label="Main">
        <button type="button" data-tour="new" className={`nav-item${building && source.kind === "agent" && !source.id ? " current" : ""}`} disabled={busy} onClick={newProject}>
          <span aria-hidden="true">＋</span> New project
        </button>
        <button
          type="button"
          data-tour="tutorial"
          className={`nav-item${mode === "tutorial" ? " current" : ""}`}
          onClick={() => {
            setMode("tutorial");
            setOpen(false);
          }}
        >
          <span aria-hidden="true">📘</span> Breadboard &amp; Pico 101
        </button>
        <button type="button" className="nav-item" onClick={() => setPartsOpen(true)}>
          <span aria-hidden="true">🧩</span> Supported parts
        </button>
      </nav>

      <div className="side-scroll">
        <section>
          <p className="side-head">Your projects</p>
          {list.length === 0 && listState === "loading" ? (
            <p className="muted small side-empty">Loading…</p>
          ) : list.length === 0 && listState === "error" ? (
            <p className="muted small side-empty">
              Couldn't load your projects. They are still saved on this computer.{" "}
              <button type="button" className="link-btn" onClick={() => void refreshList()}>
                Try again
              </button>
            </p>
          ) : list.length === 0 ? (
            <p className="muted small side-empty">Nothing here yet. Describe an idea in the box at the bottom, or open an example below.</p>
          ) : (
            <ul className="plist">
              {list.slice(0, 30).map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    disabled={busy}
                    className={building && source.kind === "agent" && source.id === x.id ? "current" : ""}
                    onClick={() => {
                      setMode("build");
                      setOpen(false);
                      void openProject(x.id);
                    }}
                  >
                    <span className="ptitle">{x.title}</span>
                    <span className={`state state-${x.running ? "running" : x.state}`}>{x.running ? "Working…" : STATE_LABEL[x.state]}</span>
                  </button>
                  <button
                    type="button"
                    className="pdel"
                    aria-label={`Delete project “${x.title}”`}
                    title={x.running ? "Wait until it's finished to delete it" : "Delete this project"}
                    disabled={busy || x.running}
                    onClick={() => {
                      if (window.confirm(`Delete “${x.title}”?\n\nThe project, its plan, wiring and code are removed for good.`)) void removeProject(x.id);
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section data-tour="examples">
          <p className="side-head">Examples</p>
          <ul className="plist">
            {DEMOS.map((d) => (
              <li key={d.id}>
                <button type="button" disabled={busy} className={building && source.kind === "demo" && source.id === d.id ? "current" : ""} onClick={() => openDemo(d.id)}>
                  <span className="ptitle">{d.title}</span>
                  <span className="muted small">{d.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="side-foot">
        <button type="button" className="nav-item settings-btn" data-tour="settings" title="OpenAI key, local AI, browser access" onClick={() => setSettingsOpen(true)}>
          <span aria-hidden="true">⚙</span> Settings
        </button>
        {/* Opens in the normal browser (the desktop app sends other sites there). */}
        <a className="icon-btn github-link" href="https://github.com/Prestical/BreadPilot" target="_blank" rel="noreferrer" aria-label="BreadPilot on GitHub" title="BreadPilot on GitHub">
          <GitHubMark />
        </a>
      </div>
    </aside>
  );
}
