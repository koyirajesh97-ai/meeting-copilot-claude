import { PageHeader } from "../components/EmptyState";

export function SystemAudioHelpPage() {
  return (
    <section className="max-w-2xl space-y-6 text-sm">
      <PageHeader title="Meeting audio isn't coming through" />
      <p>
        Meeting Copilot records two things: your microphone, and the sound your computer plays (the
        meeting). If the meeting meter stays empty while people are talking, check the steps for your
        computer.
      </p>
      <div className="space-y-2">
        <h2 className="font-medium">Windows</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Make sure the meeting plays through your default speakers or headset (Settings → System → Sound).</li>
          <li>If you chose "capture only this app", check the app name matches (new Teams is <code>ms-teams.exe</code>) and that it's running. Per-app capture needs Windows 10 build 20348 or Windows 11.</li>
          <li>Clear the app name in Settings to capture all system audio instead.</li>
        </ul>
      </div>
      <div className="space-y-2">
        <h2 className="font-medium">macOS (14.2 or later)</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Open System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording.</li>
          <li>Turn on Meeting Copilot under "System Audio Recording Only", then quit and reopen the app.</li>
        </ul>
      </div>
      <p className="text-gray-500 dark:text-gray-400">Your own microphone keeps recording either way.</p>
    </section>
  );
}
