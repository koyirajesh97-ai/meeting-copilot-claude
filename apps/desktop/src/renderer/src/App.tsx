import { AudioLines, FolderKanban, LayoutDashboard, Mic, Settings, Sparkles } from "lucide-react";
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
  { to: ROUTES.home, label: "Meetings", icon: LayoutDashboard },
  { to: ROUTES.ask, label: "Ask", icon: Sparkles },
  { to: ROUTES.projects, label: "Projects", icon: FolderKanban },
  { to: ROUTES.settings, label: "Settings", icon: Settings },
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
        <nav hidden={inSetup} aria-label="Main" className="flex w-60 shrink-0 flex-col px-4 pb-4 pt-5">
          <div className="mb-6 flex items-center gap-2.5 px-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30" aria-hidden>
              <AudioLines size={18} strokeWidth={2.25} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Meeting Copilot</span>
          </div>
          <NavLink
            to={ROUTES.start}
            className="mb-6 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-600 px-3 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-600/25 transition hover:from-indigo-500 hover:to-indigo-500"
          >
            <Mic size={16} strokeWidth={2.25} aria-hidden />
            Start meeting
          </NavLink>
          <ul className="space-y-0.5">
            {NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-800"
                        : "text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white"
                    }`
                  }
                >
                  <Icon size={17} strokeWidth={2} aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="mt-auto space-y-3">
            <div className="px-3">{state && <RecordingIndicator state={state} />}</div>
            {state?.auth.signedIn && (
              <NavLink to={ROUTES.settings} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/70 dark:hover:bg-slate-900" title="Account settings">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-xs font-semibold uppercase text-white" aria-hidden>
                  {(state.auth.email ?? "?").slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">{state.auth.email}</span>
              </NavLink>
            )}
          </div>
        </nav>
        <main className={`flex-1 overflow-y-auto bg-white dark:bg-slate-900/60 ${inSetup ? "" : "my-2 mr-2 rounded-2xl border border-slate-200/80 shadow-sm dark:border-slate-800"}`}>
          <div className="mx-auto max-w-5xl px-10 py-9">
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
          </div>
        </main>
      </div>
    </>
  );
}
