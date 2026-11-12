// One small set of line icons for the whole app (drawn here, no icon font or package), so every
// button uses the same stroke and size instead of emoji, which look different on every computer.
// 24 x 24 grid, 1.75 stroke, round ends, in the text colour. Icons are decoration: the button's
// text or aria-label says what it does.
const PATHS = {
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6L6 18",
  menu: "M4 7h16M4 12h16M4 17h16",
  check: "M5 12.5l4.5 4.5L19 7.5",
  "arrow-left": "M19 12H5M11 6l-6 6 6 6",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  "arrow-up": "M12 19V5M6 11l6-6 6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-up": "M6 15l6-6 6 6",
  book: "M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11",
  chip: "M6.5 5h11A1.5 1.5 0 0 1 19 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5v-11A1.5 1.5 0 0 1 6.5 5zM9 9h6v6H9zM9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5",
  folder: "M3.5 7a2 2 0 0 1 2-2h3.6l2 2.5h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M17 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  bolt: "M13 3L5 13.5h6L10 21l8-10.5h-6z",
  bulb: "M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2h5c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z",
  lock: "M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  alert: "M12 4l9 15.5H3zM12 10v4.5M12 17.2v.3",
  download: "M12 4v11M7 10.5l5 5 5-5M5 20h14",
  export: "M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14",
  code: "M9 7l-5 5 5 5M15 7l5 5-5 5",
  tag: "M4 5.5A1.5 1.5 0 0 1 5.5 4h6.1a1.5 1.5 0 0 1 1 .4l7 7a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0l-7-7a1.5 1.5 0 0 1-.5-1zM9.5 8.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z",
  reset: "M4 4.5V10h5.5M4.3 10A8 8 0 1 1 4 12.5",
  stop: "M8 8h8v8H8z",
  pointer: "M9 11V5.5a1.5 1.5 0 0 1 3 0V10l5.2 1.1a2 2 0 0 1 1.6 2.2l-.6 4.3A4 4 0 0 1 14.2 21h-2.6a4 4 0 0 1-3.1-1.5L5 15.2a1.4 1.4 0 0 1 2-1.9L9 15",
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/** A line icon. `size` in px (default 16). Hidden from screen readers. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} fill={name === "stop" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
