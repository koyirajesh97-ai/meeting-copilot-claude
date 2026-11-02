import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import { ROUTES } from "../../shared/ipc";
import { RecordingIndicator } from "./components/RecordingIndicator";
import { AskPage } from "./pages/AskPage";
import { MeetingDetailPage } from "./pages/MeetingDetailPage";
import { MeetingsHome } from "./pages/MeetingsHome";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StandupPage } from "./pages/StandupPage";
import { StartMeetingPage } from "./pages/StartMeetingPage";
import { SystemAudioHelpPage } from "./pages/SystemAudioHelpPage";
import { VoicePage } from "./pages/VoicePage";
import { useAppState, useSettings } from "./useAppState";

const NAV = [
  { to: ROUTES.home, label: "Meetings" },
  { to: ROUTES.start, label: "Start meeting" },
  { to: ROUTES.ask, label: "Ask my meetings" },
  { to: ROUTES.standup, label: "Standup prep" },
  { to: ROUTES.projects, label: "Projects" },
  { to: ROUTES.voice, label: "Your voice" },
  { to: ROUTES.settings, label: "Settings" },
];

export function App() {
  const state = useAppState();
  useSettings(); // applies the theme
  return (
    <HashRouter>
      <div className="flex h-full">
        <nav aria-label="Main" className="w-52 shrink-0 border-r border-gray-200 p-3 dark:border-gray-800">
          <div className="mb-4 px-2 text-lg font-semibold">Meeting Copilot</div>
          <ul className="space-y-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === "/"}
                  className={({ isActive }) =>
                    `block rounded px-2 py-1.5 text-sm ${
                      isActive
                        ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        : "hover:bg-gray-100 dark:hover:bg-gray-900"
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="mt-6 px-2">{state && <RecordingIndicator state={state} />}</div>
        </nav>
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path={ROUTES.home} element={<MeetingsHome />} />
            <Route path={ROUTES.start} element={<StartMeetingPage state={state} />} />
            <Route path={ROUTES.meeting} element={<MeetingDetailPage />} />
            <Route path={ROUTES.ask} element={<AskPage />} />
            <Route path={ROUTES.standup} element={<StandupPage />} />
            <Route path={ROUTES.projects} element={<ProjectsPage />} />
            <Route path={ROUTES.settings} element={<SettingsPage />} />
            <Route path={ROUTES.systemAudioHelp} element={<SystemAudioHelpPage />} />
            <Route path={ROUTES.voice} element={<VoicePage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
