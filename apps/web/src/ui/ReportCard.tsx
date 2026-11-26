// The hardware report card (user, 26/11/2026), above the prompt box: once a project with parts not
// tried on a real Pico yet has been built for the Pico, it asks whether it worked on the real board.
// The answer opens a pre-filled GitHub issue (report.ts) that the person checks and submits there;
// the app sends nothing itself.

import { useEffect, useMemo, useState } from "react";
import { getUpdate } from "../projects/api";
import type { ApiProject } from "../projects/types";
import { Icon } from "./Icon";
import { MAX_NOTE, osName, partLabel, PROBLEMS, REPORT_EVENT, reportState, reportUrl, setReportState, untestedParts } from "./report";

/** Projects put off with "Not built yet" in this session (asked again next time BreadPilot opens). */
const later = new Set<string>();

const joinNames = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function ReportCard({ project }: { project: ApiProject }) {
  const build = project.build?.build;
  const parts = useMemo(() => (build ? untestedParts(build) : []), [build]);
  const [, refresh] = useState(0);
  const [works, setWorks] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | undefined>();
  /** With several untested parts: the names of the ones that didn't work (none = not sure). */
  const [failed, setFailed] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    const on = () => refresh((n) => n + 1);
    window.addEventListener(REPORT_EVENT, on);
    return () => window.removeEventListener(REPORT_EVENT, on);
  }, []);
  // Another project: start from the question.
  useEffect(() => {
    setWorks(null);
    setProblem(undefined);
    setFailed([]);
    setNote("");
    setSent(false);
  }, [project.id]);
  useEffect(() => {
    getUpdate()
      .then((u) => setVersion(u.current ?? "development"))
      .catch(() => setVersion("development"));
  }, []);

  if (!parts.length || (!sent && (reportState(project.id) !== "built" || later.has(project.id)))) return null;

  const close = (state: "done" | "later") => {
    if (state === "later") later.add(project.id);
    else setReportState(project.id, "done");
    refresh((n) => n + 1);
  };

  if (sent) {
    return (
      <section className="report-card" aria-label="Hardware report">
        <p className="small">
          <strong>Thanks!</strong> Check the report on GitHub and press <strong>Create</strong> there. That's how a part gets marked as tried.
        </p>
        <button type="button" className="icon-btn report-close" aria-label="Close" onClick={() => setSent(false)}>
          <Icon name="x" size={14} />
        </button>
      </section>
    );
  }

  const url = works === null ? "" : reportUrl({ parts, works, failed, ...(problem ? { problem } : {}), note, project: project.title, version: `${version || "development"}, ${osName(navigator.platform)}` });
  return (
    <section className="report-card" aria-label="Hardware report">
      <button type="button" className="icon-btn report-close" aria-label="Don't ask about this project again" title="Don't ask about this project again" onClick={() => close("done")}>
        <Icon name="x" size={14} />
      </button>
      {works === null ? (
        <>
          <p className="small">
            <strong>Did it work on your real board?</strong> This project uses {joinNames(parts.map(partLabel))}, which {parts.length > 1 ? "haven't" : "hasn't"} been tried on a real Pico yet. Your report helps mark {parts.length > 1 ? "them" : "it"} as tested.
          </p>
          <div className="report-actions">
            <button type="button" className="btn small-btn" onClick={() => setWorks(true)}>
              <Icon name="thumbs-up" /> It worked
            </button>
            <button type="button" className="btn small-btn" onClick={() => setWorks(false)}>
              <Icon name="thumbs-down" /> It didn't work
            </button>
            <button type="button" className="link-btn small" onClick={() => close("later")}>
              Not built yet
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="small">
            <strong>{works ? "Great, it worked." : "Sorry it didn't work."}</strong> {works ? "Anything to add? (optional)" : parts.length > 1 ? "" : "What went wrong?"}
          </p>
          {!works && parts.length > 1 && (
            <>
              <p className="small">Which parts didn't work? Leave them all unpicked if you're not sure.</p>
              <div className="report-actions" role="group" aria-label="Parts that didn't work">
                {parts.map((p) => (
                  <button key={p.name} type="button" className="chip" aria-pressed={failed.includes(p.name)} onClick={() => setFailed(failed.includes(p.name) ? failed.filter((n) => n !== p.name) : [...failed, p.name])}>
                    {partLabel(p)}
                  </button>
                ))}
              </div>
              <p className="small">What went wrong?</p>
            </>
          )}
          {!works && (
            <div className="report-actions" role="group" aria-label="What went wrong">
              {PROBLEMS.map((p) => (
                <button key={p} type="button" className="chip" aria-pressed={problem === p} onClick={() => setProblem(problem === p ? undefined : p)}>
                  {p}
                </button>
              ))}
            </div>
          )}
          {problem === "Something got hot" && <p className="small report-warn">Unplug the USB cable first, and leave the board unplugged until it is checked.</p>}
          <textarea className="report-note" rows={2} maxLength={MAX_NOTE} value={note} placeholder={works ? "e.g. which board or module you used" : "What happened on the board?"} aria-label="Details (optional)" onChange={(e) => setNote(e.target.value)} />
          <div className="report-actions">
            <a
              className="btn small-btn primary"
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                setReportState(project.id, "done");
                setSent(true);
              }}
            >
              Open the report on GitHub
            </a>
            <button type="button" className="link-btn small" onClick={() => setWorks(null)}>
              Back
            </button>
          </div>
          <p className="small muted">
            Opens a filled-in issue on GitHub (a GitHub account is needed). It holds the parts, your answer and note, the project's title and the BreadPilot version; you check it and press Create there.
          </p>
        </>
      )}
    </section>
  );
}
