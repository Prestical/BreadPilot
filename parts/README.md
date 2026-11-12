# Part packs

Every part BreadPilot can wire is one folder here. Adding a part means adding a folder: the
engine (layout, validator, build steps, code checker, prompts, handoff, 3D view) reads the packs
and has no code for any particular part.

A pack is **data only** (JSON, an optional MicroPython driver, test fixtures). It can declare facts
that the engine's safety rules act on (a leg's kind, a supply limit, an LED element that needs a
resistor), but it can't switch a rule off. Facts are **reviewed by a person** before a pack is used:
a pack whose `review.status` is `draft` is left out of the app.

`npm run gen:parts` copies the packs into `packages/circuit-core/src/parts.generated.ts` (not
committed). It runs by itself before `npm test`, the dev servers, type checks and builds; run it by
hand after editing a pack while a dev server is running. A broken pack fails there with the exact
file and field.

## Files

| File | Needed | What |
|---|---|---|
| `pack.json` | always | `format` (1), `id` (= folder name), `order` (list order), `review` {status, by, date}, `kind` (the short name the plan uses, e.g. `"oled"`; leave it out for parts the AI may not pick on its own, like the resistor), `driver` (`"driver/<name>.py"`) |
| `part.json` | always | Legs (`kind`: power_in, ground, digital_in, digital_out, analog_out, i2c_sda, i2c_scl; `level: "vcc"`), elements (led, resistor, switch, short, load), props, specs. **Every number is a fact with a source** (below) |
| `layout.json` | with `kind` | How one block sits on the breadboard: `name`, `height` (rows), optional `max` (+ `maxMessage`), one pin need (`gpio`, `adc` or `i2c-pair`, with its `mode`), parts with holes relative to the block's first row, the `main` part, and the wires in order (`pin`, `ground`, `power`) |
| `text.json` | optional | Build-step texts: `place` {title, text, tip}, `why`, `wire` texts (ground, power, out, in, adc, i2c_sda, i2c_scl), and `names` for the web app (shopping list, plan card, start screen, hover, driver label) |
| `view.json` | optional | 3D look from a small shape set: `led-dome`, `axial`, `tact-button`, `rotary-knob`, `header-module`, `cylinder`, `slide-switch`, `upright-module`, `grid-sensor` (no file = a grey box) |
| `code.json` | optional | Code-checker rules: a framebuf `display` (driver class, size, font), driver `modules` hints |
| `agent.json` | with `kind` | For the AI: its line in the parts list, plan hint and plan fields, the words that name it in an idea, vocabulary it `claims` (e.g. `"buzzer"` makes buzzers supported), labels, its pin-table line, handoff rows, documentation search |
| `driver/*.py` | optional | MicroPython driver saved next to `main.py` (plain ASCII, ≤ 64 KB) |
| `tests/wirings.json`, `tests/code.json`, `tests/code/*.py` | with `kind` | Good and bad wirings (exact issue codes) and programs (exact checker codes), run by `packages/circuit-core/test/pack-cases.test.ts` |
| `SOURCES.md` | always | Documents used, what was checked, by whom |
| `reference.md` | when a cited document isn't in `docs/hardware/` | A row per document: `| File | Link | Pages used | SHA-256 |`. Datasheets whose owners don't allow republishing stay out of the repository (keep your copy in `.local/datasheets/<id>/`, which git ignores; the pack test checks it against the checksum when it's there) |

Text placeholders such as `{ref}`, `{hole.vcc}`, `{prop.color}` are checked when the pack loads.

## 3D look (the house style)

New parts are modelled the same way as the slide switch, buzzer module and DHT11, so every part looks like it belongs to the same app:

- **A shape is plain data** in `apps/web/src/scene/shapes.ts` (no React or three.js objects; `Parts.tsx`
  only turns the nodes into meshes), in millimetres (1 unit = 1 mm), and tested in
  `apps/web/test/parts3d.test.ts`. A part picks its shape and its sizes and colours in `view.json`; a
  new kind of look is a new shape function plus its `view.json` schema in `packages/circuit-core/src/packs.ts`.
- **Only simple geometry**: box, rounded box, cylinder, sphere, capsule, plane and lathe profiles. No
  image, model or HDR files: printed surfaces and textures are drawn on a canvas at run time
  (`textures.ts`, `labels.ts`), so everything works offline.
- **Shared materials**: metal legs and pins use the shared metal and tin values in `shapes.ts`; plastic
  bodies are matte (roughness about 0.45-0.6); the main body carries the step highlight (`pulse`, white
  emissive) and small details are left out of hovering (`noRaycast`).
- **Every shape supports the three states**: built, current step (it pulses) and ghost (faded, for
  parts a change step takes out).
- **Legs come from the part's real holes** (`legsOf` / `holePos`), so the body sits over the holes its
  build step names.
- **Sizes come from the datasheet** (say which page in the `view.json` note) or are marked as not
  measured, like other facts without a source.
- In the app's UI, icons are the line icons in `apps/web/src/ui/Icon.tsx`, never emoji.

## Sources of facts

```jsonc
{ "value": 3.3, "src": { "doc": "SH1106.pdf", "page": 13 } }          // a document: in docs/hardware/ or in the part's reference.md
{ "value": [3.3, 5.0], "src": { "product": "seller's product page …" } }
{ "value": 3.3, "src": { "decision": "maintainer, 20/10/2026", "why": "…" } }
{ "value": 20, "src": { "typical": true, "note": "no datasheet yet" } } // listed as unverified
```

A test checks that every cited document exists and lists the `typical` (unverified) facts.

## What still needs engine work

A part that uses the existing pin needs (digital out/in, PWM, ADC, an I2C pair) and shapes is one
folder. A part that needs something the engine doesn't know yet (1-Wire, SPI, UART, servo pulses,
a 5 V level divider, two independent pins in one block, a new 3D shape) needs that added to the
engine once, with its own golden tests; after that, every part using it is one folder again.
