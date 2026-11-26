// BreadPilot behaviour simulator: what the circuit does at one moment (M18 18.7c).
// Plain JavaScript (no Node or TypeScript features) so a Node worker thread now and a browser Web
// Worker later (sandbox, M6; Code-tab preview, 8.C3) run the same code. Input: the ElectricalModel
// from circuit.ts, the parts' state (switches, knobs, what sensors sense) and the Pico's pins (modes,
// pulls, levels, PWM). Output: node voltages, what each input pin reads, LED currents, actuators.
//
// Method: nodes joined by closed switches become groups; supplies, driven GPIOs and module outputs fix
// some groups' voltages; resistors (fixed, knobs, LDR/NTC) and the inputs' internal pulls connect them;
// the rest is solved by nodal analysis. An LED is a fixed drop (its forward voltage) while current flows
// forward through it, and open otherwise: its state is iterated until it agrees with the solution.

const HIGH = 3.3;

/** The parts' state at time t from a scenario of [[t_us, value], ...] lists. */
export function stateAt(scenario, t) {
  const at = (list, fallback) => {
    let v = fallback;
    for (const [when, value] of list ?? []) if (when <= t) v = value;
    return v;
  };
  const out = { switches: {}, pots: {}, sensors: {} };
  for (const [k, list] of Object.entries(scenario?.switches ?? {})) out.switches[k] = at(list, 0);
  for (const [k, list] of Object.entries(scenario?.pots ?? {})) out.pots[k] = at(list, 0.5);
  for (const [k, list] of Object.entries(scenario?.sensors ?? {})) out.sensors[k] = at(list, undefined);
  return out;
}

/** Every time something in the scenario changes. */
export function scenarioTimes(scenario) {
  const times = new Set();
  for (const group of [scenario?.switches, scenario?.pots, scenario?.sensors]) {
    for (const list of Object.values(group ?? {})) for (const [t] of list) times.add(t);
  }
  return [...times].sort((a, b) => a - b);
}

function groupsOf(model, state) {
  const parent = Array.from({ length: model.nodes }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (const s of model.switches) {
    const v = state.switches[s.id] ?? state.switches[s.ref] ?? 0;
    if (v) parent[find(s.a)] = find(s.b);
  }
  const roots = new Map();
  const group = new Int32Array(model.nodes);
  for (let i = 0; i < model.nodes; i++) {
    const r = find(i);
    if (!roots.has(r)) roots.set(r, roots.size);
    group[i] = roots.get(r);
  }
  return { group, count: roots.size };
}

/** Gaussian elimination with partial pivoting; returns null when the system is singular. */
function solveLinear(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-15) return null;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/**
 * Solves the circuit. `pins`: gpio -> { mode: "in"|"out"|"pwm", pull: 0|1|2, level: 0|1, duty: 0..65535 }.
 * Returns { volts(node) -> number | null (floating), ledMa: {ref: mA}, conflicts: [...] }.
 */
export function solveCircuit(model, state, pins) {
  const { group, count } = groupsOf(model, state);
  const fixed = new Array(count).fill(null);
  const conflicts = [];
  const fix = (g, v, what) => {
    if (fixed[g] === null) fixed[g] = v;
    else if (Math.abs(fixed[g] - v) > 0.01) conflicts.push(what);
  };
  for (const s of model.supplies) fix(group[s.node], s.volts, s.pin);
  for (const { gpio, node } of model.gpios) {
    const p = pins[gpio];
    if (p?.mode === "out") fix(group[node], p.level ? HIGH : 0, `GP${gpio}`);
    if (p?.mode === "pwm") fix(group[node], p.duty > 0 ? HIGH : 0, `GP${gpio}`);
  }
  // Module outputs, from their supply (only when the module is powered).
  for (const d of model.drivers) {
    const vs = fixed[group[d.supplyNode]];
    if (vs === null || vs <= 0) continue;
    const sensed = state.sensors[d.ref];
    if (d.kind === "digital") {
      const active = sensed ? 1 : 0;
      fix(group[d.node], (active ? !d.activeLow : d.activeLow) ? vs : 0, d.ref);
    } else {
      fix(group[d.node], Math.max(0, Math.min(1, sensed ?? 0)) * vs, d.ref);
    }
  }
  // Conductances between groups, and to fixed rails (the inputs' internal pulls).
  const edges = [];
  const conduct = (a, b, ohms) => {
    const ga = group[a];
    const gb = group[b];
    if (ga !== gb) edges.push([ga, gb, 1 / Math.max(ohms, 1e-3)]);
  };
  for (const r of model.resistors) conduct(r.a, r.b, r.ohms);
  for (const p of model.pots) {
    // Position: how far the wiper is from end2 toward end1 (1 = at end1): with end1 on 3V3 and end2 on
    // GND, the wiper reads position × 3.3 V.
    const pos = Math.max(0, Math.min(1, state.pots[p.ref] ?? 0.5));
    conduct(p.end1, p.wiper, Math.max(1, (1 - pos) * p.ohms));
    conduct(p.wiper, p.end2, Math.max(1, pos * p.ohms));
  }
  for (const s of model.sensorResistors) {
    const v = state.sensors[s.ref];
    const ohms =
      s.kind === "ldr"
        ? s.ohmsAt10Lux * Math.pow(Math.max(0.1, v ?? 300) / 10, -s.gamma)
        : s.ohmsAt25C * Math.exp(s.betaK * (1 / ((v ?? 25) + 273.15) - 1 / 298.15));
    conduct(s.a, s.b, ohms);
  }
  const pulls = [];
  for (const { gpio, node } of model.gpios) {
    const p = pins[gpio];
    if (p?.mode === "in" && p.pull === 1) pulls.push([group[node], HIGH, 1 / model.pullUpOhms]);
    if (p?.mode === "in" && p.pull === 2) pulls.push([group[node], 0, 1 / model.pullDownOhms]);
  }

  // Unknown groups get indices; LEDs that conduct add a current unknown each.
  const unknown = new Int32Array(count).fill(-1);
  let n = 0;
  for (let g = 0; g < count; g++) if (fixed[g] === null) unknown[g] = n++;
  const leds = model.leds.map((l) => ({ ...l, ga: group[l.anode], gc: group[l.cathode], on: false, ma: 0 }));

  let volts = null;
  for (let iter = 0; iter < 12; iter++) {
    const conducting = leds.filter((l) => l.on && l.ga !== l.gc);
    const size = n + conducting.length;
    const A = Array.from({ length: size }, () => new Array(size).fill(0));
    const b = new Array(size).fill(0);
    // A tiny leak to ground keeps groups connected to nothing solvable (they come out at 0 V and are
    // reported as floating below).
    for (let i = 0; i < n; i++) A[i][i] += 1e-12;
    const stamp = (g1, g2, G) => {
      const i = unknown[g1];
      const j = unknown[g2];
      if (i >= 0) A[i][i] += G;
      if (j >= 0) A[j][j] += G;
      if (i >= 0 && j >= 0) {
        A[i][j] -= G;
        A[j][i] -= G;
      }
      if (i >= 0 && j < 0) b[i] += G * fixed[g2];
      if (j >= 0 && i < 0) b[j] += G * fixed[g1];
    };
    for (const [g1, g2, G] of edges) stamp(g1, g2, G);
    for (const [g, v, G] of pulls) {
      const i = unknown[g];
      if (i >= 0) {
        A[i][i] += G;
        b[i] += G * v;
      }
    }
    conducting.forEach((l, k) => {
      const row = n + k; // V(anode) - V(cathode) = vf; current k flows anode -> cathode
      const ia = unknown[l.ga];
      const ic = unknown[l.gc];
      if (ia >= 0) {
        A[ia][row] += 1;
        A[row][ia] += 1;
      }
      if (ic >= 0) {
        A[ic][row] -= 1;
        A[row][ic] -= 1;
      }
      b[row] = l.vf - (ia < 0 ? fixed[l.ga] : 0) + (ic < 0 ? fixed[l.gc] : 0);
    });
    const x = solveLinear(A, b);
    if (!x) break;
    volts = (g) => (fixed[g] !== null ? fixed[g] : x[unknown[g]]);
    conducting.forEach((l, k) => (l.ma = x[n + k] * 1000)); // the unknown is the current leaving the anode into the LED
    let changed = false;
    for (const l of leds) {
      if (l.ga === l.gc) continue;
      if (l.on && l.ma < 0) {
        l.on = false;
        changed = true;
      } else if (!l.on && volts(l.ga) - volts(l.gc) > l.vf + 1e-6) {
        l.on = true;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Floating: groups with no resistive, LED or pull path to a fixed voltage.
  const reach = new Array(count).fill(false);
  const adj = Array.from({ length: count }, () => []);
  for (const [g1, g2] of edges) {
    adj[g1].push(g2);
    adj[g2].push(g1);
  }
  for (const l of leds) {
    if (l.on) {
      adj[l.ga].push(l.gc);
      adj[l.gc].push(l.ga);
    }
  }
  const queue = [];
  for (let g = 0; g < count; g++) if (fixed[g] !== null) (reach[g] = true), queue.push(g);
  for (const [g] of pulls) if (!reach[g]) (reach[g] = true), queue.push(g);
  while (queue.length) {
    const g = queue.shift();
    for (const h of adj[g]) if (!reach[h]) (reach[h] = true), queue.push(h);
  }

  return {
    volts: (node) => {
      const g = group[node];
      if (!reach[g] || !volts) return fixed[g];
      return volts(g);
    },
    group: (node) => group[node],
    ledMa: Object.fromEntries(leds.map((l) => [l.ref, l.on ? Math.max(0, l.ma) : 0])),
    conflicts,
  };
}

/** What a GPIO input reads: { level: 0|1, volts, floating, between } (datasheet thresholds). */
export function readPin(model, solved, gpio, pull) {
  const entry = model.gpios.find((g) => g.gpio === gpio);
  if (!entry) return { level: pull === 1 ? 1 : 0, volts: null, floating: true, between: false };
  const v = solved.volts(entry.node);
  if (v === null || v === undefined || Number.isNaN(v)) return { level: pull === 1 ? 1 : 0, volts: null, floating: pull !== 1 && pull !== 2, between: false };
  if (v >= model.inputHighMinV) return { level: 1, volts: v, floating: false, between: false };
  if (v <= model.inputLowMaxV) return { level: 0, volts: v, floating: false, between: false };
  return { level: v >= HIGH / 2 ? 1 : 0, volts: v, floating: false, between: true };
}

/** Volts on an ADC channel (0-3 = GP26-GP29); a floating input reads 0 here (on the board: noise). */
export function readAdc(model, solved, ch) {
  const entry = model.gpios.find((g) => g.gpio === 26 + ch);
  const v = entry ? solved.volts(entry.node) : null;
  return { volts: v === null || v === undefined || Number.isNaN(v) ? 0 : v, floating: v === null || v === undefined };
}

/**
 * Outputs a person would see or hear: each LED's current (mA, scaled by the PWM duty of the pin that
 * drives it) and each actuator module (on as a fraction 0-1, and a tone frequency when it is switched
 * by PWM).
 */
export function devices(model, solved, pins) {
  const leds = {};
  for (const l of model.leds) {
    let ma = solved.ledMa[l.ref] ?? 0;
    if (ma > 0) {
      // The PWM pins in the LED's groups scale it (the pin that switches it on and off).
      for (const { gpio, node } of model.gpios) {
        const p = pins[gpio];
        if (p?.mode === "pwm" && (solved.group(node) === solved.group(l.anode) || solved.group(node) === solved.group(l.cathode) || connected(model, solved, node, l))) {
          ma *= solved.group(node) === solved.group(l.cathode) ? 1 - p.duty / 65535 : p.duty / 65535;
        }
      }
    }
    leds[l.ref] = Math.round(ma * 100) / 100;
  }
  const actuators = {};
  for (const a of model.actuators) {
    const pin = model.gpios.find((g) => solved.group(g.node) === solved.group(a.node));
    const p = pin ? pins[pin.gpio] : undefined;
    if (p?.mode === "pwm") {
      const high = p.duty / 65535;
      const on = a.activeLow ? 1 - high : high;
      actuators[a.ref] = { on: Math.round(on * 1000) / 1000, freq: on > 0 && on < 1 ? p.freq ?? 0 : 0 };
    } else {
      const v = solved.volts(a.node);
      const level = v !== null && v !== undefined && v >= model.inputHighMinV ? 1 : 0;
      actuators[a.ref] = { on: (a.activeLow ? !level : level) ? 1 : 0, freq: 0 };
    }
  }
  return { leds, actuators };
}

/** Whether a GPIO's group reaches an LED's anode or cathode through one resistor (the usual LED block). */
function connected(model, solved, node, led) {
  const g = solved.group(node);
  const ends = [solved.group(led.anode), solved.group(led.cathode)];
  return model.resistors.some((r) => {
    const a = solved.group(r.a);
    const b = solved.group(r.b);
    return (a === g && ends.includes(b)) || (b === g && ends.includes(a));
  });
}
