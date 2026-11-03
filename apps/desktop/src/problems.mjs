// What the user is told, and offered, when BreadPilot can't start or its engine stops (D6). Pure,
// so it's unit-tested; main.mjs shows the dialog and carries out the choice.
//
// Actions: "retry", "fresh" (keep the unreadable files aside, start without them), "folder"
// (show the data folder), "log" (show the log file), "quit".

const FRESH_DETAIL = "“Start fresh” keeps the old file next to the new one (named …broken-DATE), so nothing is deleted.";

/**
 * The dialog for a startup problem. `kind` comes from the engine (desktop.ts) or from the key step:
 * locked, snapshot-auth, wrong-key, snapshot-format, snapshot-corrupt, settings, key, key-missing,
 * storage, exit, other.
 */
export function startupProblem(kind, message, platform) {
  switch (kind) {
    case "locked":
      return {
        message: "BreadPilot's data is in use by another BreadPilot program.",
        detail: "Close the other one (for example a development server) and try again.",
        buttons: [{ label: "Try again", action: "retry" }, { label: "Quit", action: "quit" }],
      };
    case "key-missing":
      return {
        message: "The key to your saved projects is missing.",
        detail: `BreadPilot keeps it in your ${platform === "darwin" ? "keychain (“BreadPilot data key”)" : "app-data folder (key.bin), protected by your operating system"} and couldn't find it; it may have been deleted. Your project files weren't changed. ${FRESH_DETAIL}`,
        buttons: freshButtons(),
      };
    case "snapshot-auth":
    case "wrong-key":
    case "key":
      return {
        message: "Your saved projects can't be unlocked on this computer.",
        detail: `The key that unlocks them is kept by your operating system and couldn't be read (for example after moving the data to another computer). ${FRESH_DETAIL}`,
        buttons: freshButtons(),
      };
    case "snapshot-format":
    case "snapshot-corrupt":
      return {
        message: "The file with your saved projects is damaged.",
        detail: `It was left exactly as it is. ${FRESH_DETAIL}`,
        buttons: freshButtons(),
      };
    case "settings":
      return {
        message: "BreadPilot's settings file can't be read.",
        detail: `Your projects are fine. “Start fresh” resets the settings (the OpenAI key and the AI options) and keeps the old file next to the new one (named …broken-DATE), so nothing is deleted.`,
        buttons: freshButtons(),
      };
    case "storage":
      return platform === "darwin"
        ? {
            message: "BreadPilot can't use your login keychain.",
            detail: "BreadPilot keeps the key to your projects in your login keychain, and it may be locked. Open Keychain Access, unlock the “login” keychain with your Mac password, then start BreadPilot again.",
            buttons: [{ label: "Try again", action: "retry" }, { label: "Quit", action: "quit" }],
          }
        : {
            message: "This computer's secure storage isn't available.",
            detail: "BreadPilot keeps the key to your projects there (macOS Keychain, Windows credential store or a Linux keyring). On Linux, install and unlock a keyring such as GNOME Keyring or KWallet, then start BreadPilot again.",
            buttons: [{ label: "Quit", action: "quit" }],
          };
    default:
      return {
        message: "BreadPilot couldn't start.",
        detail: message ? `${message}\n\nThe log file has more details.` : "The log file has more details.",
        buttons: [{ label: "Try again", action: "retry" }, { label: "Show log", action: "log" }, { label: "Quit", action: "quit" }],
      };
  }
}

function freshButtons() {
  return [
    { label: "Start fresh…", action: "fresh" },
    { label: "Show data folder", action: "folder" },
    { label: "Quit", action: "quit" },
  ];
}

/**
 * macOS, once, on a Mac that ran a build from before 0.2.0: the key moves from key.bin to the
 * keychain, and reading key.bin the old way makes macOS ask for the login password. Said before it
 * happens, so the system's prompt isn't a surprise.
 */
export function keyMoveNotice(name = "BreadPilot") {
  return {
    message: "BreadPilot is moving the key to your projects to a safer place",
    detail:
      `macOS will now ask for your Mac login password, possibly 2–3 times. That is BreadPilot reading its own key from your keychain (“${name} Safe Storage”), once. Choose “Allow”.\n\nAfter this you won't be asked again, not even after updates.`,
    buttons: [{ label: "Continue", action: "continue" }, { label: "Quit", action: "quit" }],
  };
}

/** The engine stopped while the app was open. */
export function crashProblem() {
  return {
    message: "BreadPilot's engine stopped unexpectedly.",
    detail: "Your projects are saved about a second after every change, so at most the last moment may be missing. Restart to continue.",
    buttons: [{ label: "Restart", action: "retry" }, { label: "Show log", action: "log" }, { label: "Quit", action: "quit" }],
  };
}

/**
 * The files "Start fresh" moves aside for each problem: only what can't be read, so a damaged
 * projects file doesn't cost the settings, and a broken settings file doesn't cost the projects.
 * A lost key makes both unreadable, so the key goes too (a new one is made).
 */
export function filesToSetAside(kind) {
  switch (kind) {
    case "snapshot-auth":
    case "snapshot-format":
    case "snapshot-corrupt":
      return ["data/data.enc"];
    // The projects and the settings use the same key: both are set aside together, so one problem is one question.
    case "wrong-key":
    case "key-missing":
      return ["data/data.enc", "data/settings.enc"];
    case "settings":
      return ["data/settings.enc"];
    case "key":
      return ["key.bin", "data/data.enc", "data/settings.enc"];
    default:
      return [];
  }
}
