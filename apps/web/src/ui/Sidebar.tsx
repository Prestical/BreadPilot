import { HealthBadge } from "../HealthBadge";
import { DEMOS } from "../demos";
import { STATE_LABEL } from "../projects/progress";
import { useApp } from "../store";

/** Left column: new project, tutorial, your projects, examples, system status. */
export function Sidebar() {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const source = useApp((s) => s.source);
  const list = useApp((s) => s.agent.list);
  const busy = useApp((s) => s.agent.busy);
  const openProject = useApp((s) => s.openProject);
  const removeProject = useApp((s) => s.removeProject);
  const openDemo = useApp((s) => s.openDemo);
  const newProject = useApp((s) => s.newProject);
  const open = useApp((s) => s.sidebarOpen);
  const setOpen = useApp((s) => s.setSidebarOpen);
  const building = mode === "build";

  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="Projects">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          ⚡
        </span>
        <span>BreadPilot</span>
        <span className="board-chip">Pico 2 W</span>
        <button type="button" className="icon-btn drawer-close" aria-label="Close the project list" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>

      <nav className="side-nav" aria-label="Main">
        <button type="button" className={`nav-item${building && source.kind === "agent" && !source.id ? " current" : ""}`} disabled={busy} onClick={newProject}>
          <span aria-hidden="true">＋</span> New project
        </button>
        <button
          type="button"
          className={`nav-item${mode === "tutorial" ? " current" : ""}`}
          onClick={() => {
            setMode("tutorial");
            setOpen(false);
          }}
        >
          <span aria-hidden="true">📘</span> Breadboard &amp; Pico 101
        </button>
      </nav>

      <div className="side-scroll">
        {list.length > 0 && (
          <section>
            <p className="side-head">Your projects</p>
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
          </section>
        )}
        <section>
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
        <HealthBadge />
      </div>
    </aside>
  );
}
