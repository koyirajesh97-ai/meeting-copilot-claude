import { useEffect, useRef } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "../../shared/ipc";
import { RecordingIndicator } from "./components/RecordingIndicator";
import { AskPage } from "./pages/AskPage";
import { MeetingDetailPage } from "./pages/MeetingDetailPage";
import { MeetingsHome } from "./pages/MeetingsHome";
import { ProjectDetailPage, ProjectsPage } from "./pages/ProjectsPage";
import { LiveViewerPage } from "./projects/LiveViewerPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StandupPage } from "./pages/StandupPage";
import { StartMeetingPage } from "./pages/StartMeetingPage";
import { SystemAudioHelpPage } from "./pages/SystemAudioHelpPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SetupPage } from "./pages/SetupPage";
import { VoicePage } from "./pages/VoicePage";
import { useAppState, useSettings } from "./useAppState";

// Four places to go, plus the one thing you do most: start a meeting. Standup prep, your role
// and your voice are reached from Meetings and Settings.
const NAV = [
  { to: ROUTES.home, label: "Meetings" },
  { to: ROUTES.ask, label: "Ask" },
  { to: ROUTES.projects, label: "Projects" },
  { to: ROUTES.settings, label: "Settings" },
];

/** First run: open the setup until it's finished or skipped. */
function FirstRun({ setupDone }: { setupDone: boolean | undefined }) {
  const navigate = useNavigate();
  const location = useLocation();
  const done = useRef(false);
  useEffect(() => {
    // Once per launch, from the home screen only: finishing or skipping setup never loops back.
    if (done.current || setupDone === undefined) return;
    done.current = true;
    if (setupDone === false && location.pathname === "/") navigate("/setup", { replace: true });
  }, [setupDone, location.pathname, navigate]);
  return null;
}

export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const state = useAppState();
  const [settings] = useSettings(); // also applies the theme
  // Setup gets the whole window: no sidebar to wander off into.
  const inSetup = useLocation().pathname === ROUTES.setup;
  return (
    <>
      <FirstRun setupDone={settings?.setupDone} />
      <div className="flex h-full">
        <nav hidden={inSetup} aria-label="Main" className="w-52 shrink-0 border-r border-gray-200 p-3 dark:border-gray-800">
          <div className="mb-5 px-2 text-lg font-semibold">Meeting Copilot</div>
          <NavLink
            to={ROUTES.start}
            className="mb-5 block rounded-lg bg-blue-600 px-3 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            Start meeting
          </NavLink>
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
            <Route path={ROUTES.project} element={<ProjectDetailPage />} />
            <Route path={ROUTES.meetingLive} element={<LiveViewerPage />} />
            <Route path={ROUTES.settings} element={<SettingsPage />} />
            <Route path={ROUTES.systemAudioHelp} element={<SystemAudioHelpPage />} />
            <Route path={ROUTES.voice} element={<VoicePage />} />
            <Route path={ROUTES.profile} element={<ProfilePage />} />
            <Route path={ROUTES.setup} element={<SetupPage />} />
          </Routes>
        </main>
      </div>
    </>
  );
}
