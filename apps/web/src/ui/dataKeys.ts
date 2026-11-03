// Settings → "Your data and keys": where the projects and the OpenAI key are kept, in plain words
// for the computer the app runs on (SettingsView.dataHome). Pure, so it's unit-tested.

export interface DataKeysText {
  intro: string;
  points: string[];
}

export function dataKeysText(platform: string | null | undefined): DataKeysText {
  const openAi = "Your OpenAI key is saved with them, encrypted the same way. It's only ever sent to OpenAI, and this screen only ever shows its last 4 characters.";
  switch (platform) {
    case "darwin":
      return {
        intro: "Your projects and settings are saved encrypted on this Mac. The key that unlocks them is in your login keychain as “BreadPilot data key”.",
        points: [
          openAi,
          "BreadPilot reads that key through Apple's built-in keychain tool, so it never needs to ask for your Mac password, not even after an update.",
          "It's protected by your login password: a copy of your disk or a backup can't open your projects. Other programs you run on this Mac could read the key, as with any app that isn't signed with an Apple certificate.",
          "A macOS window that names “BreadPilot data key” or “BreadPilot Safe Storage” is genuine. BreadPilot never asks for a password in its own window.",
        ],
      };
    case "win32":
      return {
        intro: "Your projects and settings are saved encrypted on this computer. The key that unlocks them is protected by Windows for your user account.",
        points: [openAi, "Another Windows user on this computer, or a copy of your disk, can't open them."],
      };
    case "linux":
      return {
        intro: "Your projects and settings are saved encrypted on this computer. The key that unlocks them is kept in your keyring (for example GNOME Keyring or KWallet).",
        points: [openAi, "Without a keyring BreadPilot doesn't save an OpenAI key at all, because it couldn't be kept safe."],
      };
    default:
      return {
        intro: "This development server keeps its settings in memory and its projects in .local/data with a development key.",
        points: [],
      };
  }
}
