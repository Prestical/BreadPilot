# Making a part's 3D model

Every part BreadPilot can wire is drawn in its 3D scene from **code, not model files**: a few
simple shapes per part, written as plain data. This guide is the way to make a new one so it looks
like it belongs with the existing parts (the slide switch, buzzer module, DHT11, photoresistor,
the upright sensor modules…). Work through the seven steps in order; step 6 sends you back to
step 3 until the model is good enough.

**Where things are**

| What | Where |
|---|---|
| The shape functions (one per kind of look) | `apps/web/src/scene/shapes.ts` |
| A part's look: shape name, sizes, colours | `parts/<id>/view.json` |
| The `view.json` format and its checks | `packages/circuit-core/src/packs.ts` (`ViewSpec`, `checkViewSpec`) |
| The camera framing in Supported parts | `apps/web/src/scene/PartPreview.tsx` (`previewFrame`) |
| Coordinates and breadboard sizes | `apps/web/src/scene/coords.ts` |
| A model's size and collisions | `apps/web/src/scene/bounds.ts` |
| Tests | `apps/web/test/parts3d.test.ts`, `apps/web/test/bounds.test.ts` |
| Model sheet (see a model from four angles) | `npm run model-sheet -w @breadpilot/web` (step 6) |

---

## 1. Research the model

Find out **exactly which part** you are drawing before drawing anything.

- **Pick the common version.** Packs describe the version most people can buy (starter kits,
  "37-in-1" sensor kits, local shops, marketplaces). Note its standard name: the chip (A3144,
  TTP223, DS18B20) or the module (FC-51, KY-024, HW-…).
- **Get the dimensions**, in this order of trust:
  1. the maker's datasheet: its **mechanical drawing** (body size, leg pitch, height, pin order);
  2. a seller's drawing or listed size;
  3. the usual size for that kind of part, marked as not measured.
- **Write down** for each size where it came from. The `view.json` `note` says it: `"Body 15.1 x 25 x
  7.7 mm (AM2302 datasheet p. 2)"` or `"Not measured: the usual size of this part."`
- **Note what matters on the breadboard:** how many legs, their spacing (2.54 mm on almost
  everything; 1.27 mm under a TO-92 body, bent out to 2.54), the pin order printed on the board,
  and which side the parts face.

## 2. Find its image

Collect pictures that show the part from **several sides**: top, front, the pin side and the side
with the components. Good sources: the maker's product page and datasheet, distributor photos, and
clear seller photos of the common module.

- Prefer photos taken straight on (they show proportions) over angled ones (they show depth).
- Look for one photo with a ruler or a known size (a 2.54 mm header, a 5 mm LED) to check scale.
- The pictures are **references only**: nothing from them is copied into the repository. The
  model is drawn from shapes; any printed text is drawn at run time.

## 3. Analyse the image

Break the photo down into a **parts list with sizes in millimetres**, before writing code:

1. **What goes into the breadboard:** legs or header pins, their count, spacing and order.
2. **The main body:** the one piece that "is" the part (the case, the board, the dome). It gets
   the step highlight later.
3. **Secondary pieces:** a lid, a tab, a buzzer on a board, a trimmer, a lens, a cable.
4. **Small details:** chips, SMD resistors and LEDs, solder joints, holes, grooves, grids.
5. **Marks that tell the orientation:** a flat side, a stripe, a "+", pin 1, printed pin names.
6. **Colours:** take each one as a hex value from the photo (`#1d3c8f` module blue, `#17181b`
   black plastic…). Prefer the colours the existing models already use for the same materials.

For each item, write its size (across × up × along), where it sits relative to the legs, and which
basic shape it is (step 4). Leave out what can't be seen at the scene's size (a 0.2 mm marking on
a 3 mm part): every mesh costs.

## 4. Plan how to draw it in BreadPilot

### The coordinate system
- **1 unit = 1 mm.** `x` runs across the breadboard (columns a–j; the centre channel is at x = 0),
  `y` is up (the breadboard's top is y = 0), `z` runs along it (rows; row 1 at the back).
  Hole pitch: `PITCH` = 2.54 mm.
- A shape function gets the **placed part**: `legsOf(part)` gives each leg's hole position
  (`holePos`). Everything is built **around those holes**, so the model always stands in the holes
  its build step names.
- Put the body in a `group` at the legs' middle (`mid(...)`), turned with
  `rotation: [0, turnTo(firstLeg, lastLeg), 0]`: in that group, local `+z` runs from the first leg
  to the last. Then the same code works on both halves of the board and in any direction.
- **Which way it faces:** parts with a front face the centre channel, so wires use the outer holes:
  `const face = center[0] < 0 ? 1 : -1`.

### From shapes to geometry
| You see | Draw it with |
|---|---|
| A block, a board, a chip | `box` (`roundedBox` when the edges are visibly round) |
| A can, a disc, a pin, a hole | `cylinder` (its axis is `y`; `rotation: [0, 0, Math.PI / 2]` lays it along `x`, `[Math.PI / 2, 0, 0]` along `z`) |
| Part of a round wall (a TO-92 back, a stripe) | `cylinder` with `arc: [start, length]` |
| A turned outline (an LED dome, a resistor's "dog bone", a capacitor sleeve, a bead) | `lathe` with a `[radius, y]` profile |
| A rod with round ends (a glass tube) | `capsule` |
| Printed text or a pattern | `plane` with a `map` (text drawn on a canvas, `labels.ts`) |
| A straight leg | `rod` node |
| A bent leg or a wire | `lead` node (`points`, `radius` 0.22–0.3 for legs, `bend` 0.5–1.2) |

### Materials (the house look)
- Plain colour: `std(color, opacity, extra)`. Metal: `{ ...METAL }` (metalness 0.85, roughness
  0.3); legs and pins use `TIN`. Plastic is matte: roughness about **0.45–0.6**; glossy epoxy or
  glass about 0.06–0.3.
- **Exactly one mesh** carries `pulse: true` and `emissive: "#ffffff"`: the main body. That is
  what glows on the current build step.
- Small details get `noRaycast: true` (they don't catch the mouse); the body's group gets
  `hover: true` (the part's name shows on hover).
- **Three states** from `state`: `opacity = fade(state)` everywhere (ghost = faded, for parts a
  change step removes). Clear parts (LED epoxy, glass) use a lower opacity and `transparent: true`.
- Text: `{ kind: "basic", map: { text, bg, fg, width, height }, transparent: true, opacity }` on a
  `plane`. Put it 0.02–0.05 mm above the surface (never exactly on it: the surfaces flicker).

### Decide what to add
In order of preference:

1. **An existing shape with new sizes and colours**: only a `view.json`. (Most sensor modules are
   an `upright-module` with a list of `features`.)
2. **A new `feature`** on `upright-module` / `header-module` (`moduleFeature` in `shapes.ts`) for a
   new kind of component on a board.
3. **A new shape function**, only for a new kind of look. It needs all of: the `ViewSpec` variant
   and its `checkViewSpec` schema in `packs.ts`, the `case` in `viewShapes`, the function, a
   `previewFrame` case, and tests.

### Check the layout too
- The model must not reach over the Pico or into another block's rows beyond the pack's
  `reach` (`layout.json`: how many rows the body goes past its first and last row). A wide
  upright board needs a larger reach; the tests measure it.
- Legs go in their own rows on their side of the channel (two legs in one row on one side would
  be joined by the breadboard).

## 5. Start from the existing models

Find the existing model that looks most like the new part and **build on its code**: same
helpers, same material values, same habits. Don't start from an empty function.

| The new part looks like… | Start from (`shapes.ts`) |
|---|---|
| A round thing on two legs | `metalCan` (tilt switch), `photoDisc` (LDR), `bead` (thermistor), `canCapacitor`, `discCapacitor` |
| Something lying between two holes | `axial` (resistor), `diode`, `glassAxial` (reed switch) |
| A small transistor-like case | `to92`, `to220` |
| A module standing on a bent header | `uprightModule` + `moduleFeature` (buzzer module, IR, flame, sound, touch, water sensors) |
| A module lying flat on its header | `headerModule` (OLED) |
| A boxed sensor on a row of legs | `gridSensor` (DHT11, DHT22) |
| A part beside the breadboard, on wires | `tethered` (servo, motors, LCD, stepper), `keypad`, the soil `probe` feature |
| An LED or lamp | `led`, `rgbLed`, the `lamp` and `emitter` features |
| A switch or knob | `slideSwitch`, `button`, `knob` |
| Digits, segments, a dot matrix | `sevenSegment`, the `digits` and `matrix` features |

A new shape function has this outline (from the existing ones):

```ts
function myPart(part: ResolvedPart, state: ItemState, v: Spec<"my-part">): ShapeNode {
  const legs = legsOf(part);
  const pts = v.legs.map((id) => legs[id]!);
  const center = mid(pts);
  const opacity = fade(state);
  const baseY = 2; // where the legs end and the body starts
  return {
    node: "group",
    children: [
      // legs: from each hole up to the body
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], baseY + 0.3, p[2]], opacity })),
      group(
        [center[0], baseY, center[2]],
        [
          // the main body: the one mesh that pulses
          { node: "mesh", position: [0, 2, 0], geometry: { type: "roundedBox", args: [4, 4, 6, 0.3] }, pulse: true, material: std(v.body, opacity, { emissive: "#ffffff", roughness: 0.5 }) },
          // details: noRaycast, a hair above the surface they sit on
          { node: "mesh", position: [0, 4.03, 0], noRaycast: true, geometry: { type: "box", args: [2, 0.06, 3] }, material: std("#0b0d12", opacity) },
        ],
        { rotation: [0, turnTo(pts[0]!, pts[pts.length - 1]!), 0], hover: true },
      ),
    ],
  };
}
```

## 6. Check it: is it good enough?

### See it
```
npm run model-sheet -w @breadpilot/web
```
then open `apps/web/.model-sheet/index.html` in a browser with one of:

| Hash | Shows |
|---|---|
| `#kinds=ldr` | one part, laid out by the real engine (with its resistor or pull-up) |
| `#kinds=dht22,oled,buzzer` | several parts next to each other, as a project would place them |

The sheet shows four fixed views (the app's preview angle, the channel side, the top, and the side
along the rows) over a piece of breadboard with its holes, and a report: the body's size, how far
it reaches past its rows against the declared `reach`, and any collision between parts.
(`MODEL_SHEET_OUT=<folder>` builds it somewhere else, for a server that serves from there.)

### Compare with the photos, view by view
- [ ] Proportions: body width, height and depth against the photo (the report gives the mm).
- [ ] Every leg ends in its own hole; nothing floats, nothing sinks into the breadboard.
- [ ] The front faces the right way (the centre channel for modules); pin 1 and the orientation
      mark (flat side, stripe, "+") are where the part's drawing puts them.
- [ ] Colours match the photo and the other parts made of the same thing.
- [ ] Printed text is readable, the right way round, and not flickering.
- [ ] Next to other parts (`#kinds=…,…`) nothing goes through anything.
- [ ] In the app: the step highlight pulses the body; the part's preview in Supported parts is framed
      well (`previewFrame`).

### Run the checks
- `npx vitest run apps/web` — `parts3d.test.ts` checks every model stands in its holes, has exactly
  one highlighted body, fades as a ghost and has only finite numbers; `bounds.test.ts` checks the
  `reach` and that no two parts collide.
- `npm run typecheck`.

**Not good enough?** Write down what differs ("the dome is too tall", "the pins are on the wrong
side", "the board covers the next part") and **go back to step 3**: re-read that part of the photo,
fix the plan, change the code, look again. Repeat until every box is ticked.

## 7. Finish the model

- [ ] The look is in the pack's `view.json`, with a `note` that names the size's source or says
      "Not measured".
- [ ] `layout.json` has the right `reach` (the model sheet's report and `bounds.test.ts` agree).
- [ ] A test for what makes this model recognisable (e.g. "the IR sensor has two emitters past
      the top edge"), next to the similar ones in `parts3d.test.ts`.
- [ ] A new shape has its `previewFrame` case, so Supported parts frames it well.
- [ ] `SOURCES.md` lists where the 3D sizes came from.
- [ ] All tests and the typecheck pass; the part has been looked at in the app.

## Habits of the existing models

- Small, readable functions: named sizes (`const R = 2.5`, `const baseY = 4.2`), a short comment on
  what each piece is ("the raised ring and the sound hole on the buzzer's face").
- Details are only as fine as the scene shows: legs 0.22–0.3 mm thick, flat prints 0.04–0.1 mm,
  14–40 segments on round things.
- Reuse the existing colours for the same materials: module blue `#1d3c8f`, black plastic
  `#17181b`/`#1d1f23`, header black `#1d1f23`, gold pads `#d8ae3c`, dark holes `#0b0d12`.
- No image, model or HDR files, no downloads: everything is drawn at run time, so the app works
  offline.
