// Hardware reports (26/11/2026): which parts a report is about, the pre-filled GitHub link, and the
// per-project answer this computer remembers.
import { layoutProject } from "@breadpilot/circuit-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { failedParts, MAX_NOTE, osName, partLabel, reportState, reportUrl, setReportState, untestedParts } from "../src/ui/report";

describe("untested parts", () => {
  it("only parts not tried on a real Pico, one entry per kind with its refs; the engine's resistors don't count", () => {
    const build = layoutProject([{ kind: "ldr" }, { kind: "ldr" }, { kind: "led" }, { kind: "touch" }]).build;
    const parts = untestedParts(build);
    expect(parts).toEqual([
      { name: "Photoresistor (LDR, GL5528)", refs: ["LDR1", "LDR2"] },
      { name: "Touch sensor module (TTP223, 3 pins)", refs: ["TCH1"] },
    ]);
    expect(parts.map(partLabel)).toEqual(["Photoresistor (LDR1, LDR2)", "Touch sensor module (TCH1)"]);
  });

  it("a project made only of tried parts has none (no card)", () => {
    expect(untestedParts(layoutProject([{ kind: "led" }, { kind: "button" }, { kind: "pot" }, { kind: "dht11" }, { kind: "oled" }]).build)).toEqual([]);
  });
});

describe("the GitHub link", () => {
  const parts = [{ name: "Photoresistor (LDR, GL5528)", refs: ["LDR1"] }];
  const read = (url: string) => {
    const u = new URL(url);
    return { path: `${u.origin}${u.pathname}`, q: Object.fromEntries(u.searchParams) };
  };

  it("opens the hardware report form with every field filled, and no labels (those need repo rights)", () => {
    const { path, q } = read(reportUrl({ parts, works: false, problem: "Nothing happened", note: "  The LED stayed off.  ", project: "Night light", version: "0.4.0-beta.1, macOS" }));
    expect(path).toBe("https://github.com/Prestical/BreadPilot/issues/new");
    expect(q).toEqual({
      template: "hardware-report.yml",
      title: "Hardware report: Photoresistor doesn't work",
      parts: "Photoresistor (LDR, GL5528)",
      result: "Doesn't work",
      failed: "Photoresistor (LDR, GL5528)",
      problem: "Nothing happened",
      details: "The LED stayed off.",
      project: "Night light",
      version: "0.4.0-beta.1, macOS",
    });
  });

  it("a working report has no problem; a long note is cut so the link stays short", () => {
    const { q } = read(reportUrl({ parts, works: true, problem: "Nothing happened", note: "x".repeat(2000), project: "P", version: "development, Linux" }));
    expect(q.result).toBe("Works");
    expect(q.title).toBe("Hardware report: Photoresistor works");
    expect(q.problem).toBeUndefined();
    expect(q.failed).toBeUndefined();
    expect(q.details).toHaveLength(MAX_NOTE);
  });

  it("with several parts, a report names the ones that didn't work, or says it isn't sure which", () => {
    const three = [
      { name: "Photoresistor (LDR, GL5528)", refs: ["LDR1"] },
      { name: "Touch sensor module (TTP223, 3 pins)", refs: ["TCH1"] },
      { name: "Reed switch", refs: ["REED1"] },
    ];
    const base = { parts: three, project: "P", version: "v" };
    // Picked out of order: the report keeps the project's order.
    let { q } = read(reportUrl({ ...base, works: false, failed: ["Reed switch", "Photoresistor (LDR, GL5528)"] }));
    expect(q.failed).toBe("Photoresistor (LDR, GL5528), Reed switch");
    expect(q.title).toBe("Hardware report: Photoresistor, Reed switch don't work");
    ({ q } = read(reportUrl({ ...base, works: false, failed: [] })));
    expect(q.failed).toBe("Not sure which");
    expect(q.title).toBe("Hardware report: Photoresistor, Touch sensor module, Reed switch: something doesn't work");
    ({ q } = read(reportUrl({ ...base, works: true, failed: ["Reed switch"] })));
    expect(q.failed).toBeUndefined();
    expect(q.title).toBe("Hardware report: Photoresistor, Touch sensor module, Reed switch work");
    // One part: it's the one, without picking.
    expect(failedParts({ parts: [three[0]!], works: false })).toEqual([three[0]]);
    expect(failedParts({ parts: three, works: false, failed: ["nope"] })).toEqual([]);
  });

  it("the form's field ids are the ones the link fills", async () => {
    const { readFileSync } = await import("node:fs");
    const form = readFileSync(new URL("../../../.github/ISSUE_TEMPLATE/hardware-report.yml", import.meta.url), "utf8");
    for (const id of ["parts", "result", "failed", "problem", "details", "project", "version"]) expect(form).toMatch(new RegExp(`\\n    id: ${id}\\n`));
  });

  it("names the computer plainly", () => {
    expect(["MacIntel", "Win32", "Linux x86_64", ""].map(osName)).toEqual(["macOS", "Windows", "Linux", "unknown"]);
  });
});

describe("what this computer remembers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("built → asks; answered → done, and a later build doesn't ask again", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    expect(reportState("p1")).toBeNull();
    setReportState("p1", "built");
    expect(reportState("p1")).toBe("built");
    setReportState("p1", "done");
    setReportState("p1", "built");
    expect(reportState("p1")).toBe("done");
  });
});
