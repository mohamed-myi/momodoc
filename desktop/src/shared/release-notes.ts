export interface ReleaseNotesEntry {
  version: string;
  title: string;
  highlights: string[];
}

const RELEASE_NOTES: ReleaseNotesEntry[] = [
  {
    version: "0.1.0",
    title: "Desktop UX Productization",
    highlights: [
      "Bundled desktop app icons and packaging improvements for installer-ready builds.",
      "Launch profiles and startup settings for desktop, web UI, overlay, and VS Code companion workflows.",
      "In-app diagnostics, clearer startup failure recovery, and a first-run onboarding setup wizard.",
      "Launcher-style home surface with quick actions, status badges, and recent items.",
    ],
  },
];

export function getReleaseNotesForVersion(version: string): ReleaseNotesEntry | null {
  return RELEASE_NOTES.find((entry) => entry.version === version) ?? null;
}

export function getKnownReleaseNotesVersions(): string[] {
  return RELEASE_NOTES.map((entry) => entry.version);
}
