import { ArrowLeft, Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { buttonClass, inputClass, secondaryButtonClass } from "./EmptyState";

type Mode = "signin" | "signup" | "code" | "forgot";

const MIN_PASSWORD = 8;

export function errorMessage(err: unknown): string {
  return ((err as Error)?.message ?? String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** Google's "G", in its own colors (the sign-in button's usual look). */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function PasswordInput({ value, onChange, label, autoComplete }: { value: string; onChange: (v: string) => void; label: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block text-sm font-medium">
      {label}
      <span className="relative mt-1 block">
        <input
          className={`${inputClass} pr-10`}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow(!show)}
        >
          {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </span>
    </label>
  );
}

/**
 * Sign in or create an account: email and password, Google (where available), or a one-time
 * email code (no password, or a forgotten one).
 */
export function LoginForm({ initialError = null, devAvailable = false }: { initialError?: string | null; devAvailable?: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [note, setNote] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    void window.copilot.auth.providers().then((p) => setGoogle(p.google), () => setGoogle(false));
  }, []);

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setNote(null);
    setCode("");
    setCodeSent(false);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // The desktop app signs in through the system browser; clicking again starts over (the
  // earlier attempt is cancelled), so a closed browser tab never leaves the form stuck.
  const [waitingForBrowser, setWaitingForBrowser] = useState(false);
  const googleAttempt = useRef(0);
  const continueWithGoogle = async () => {
    const attempt = ++googleAttempt.current;
    setBusy(true);
    setError(null);
    setWaitingForBrowser(true);
    setNote("Finish signing in with Google in your browser, then come back here.");
    try {
      await window.copilot.auth.google();
      if (attempt === googleAttempt.current) setNote(null);
    } catch (err) {
      if (attempt === googleAttempt.current) {
        setNote(null);
        setError(errorMessage(err));
      }
    } finally {
      if (attempt === googleAttempt.current) {
        setBusy(false);
        setWaitingForBrowser(false);
      }
    }
  };

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const sendCode = () =>
    run(async () => {
      await window.copilot.auth.sendCode(email);
      setCodeSent(true);
      setNote(`We emailed a 6-digit code to ${email.trim()}.`);
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === "signin") void run(() => window.copilot.auth.signIn(email, password));
    else if (mode === "signup") {
      if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for the password.`);
      void run(async () => {
        const r = await window.copilot.auth.signUp(email, password);
        if (r.needsConfirmation) {
          setMode("code");
          setCodeSent(true);
          setNote(`Almost there: we emailed a 6-digit code to ${email.trim()} to confirm it's you.`);
        }
      });
    } else if (!codeSent) void sendCode();
    else if (mode === "forgot") {
      if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for the new password.`);
      // Signing in with the code, then saving the new password.
      void run(async () => {
        await window.copilot.auth.verifyCode(email, code);
        await window.copilot.auth.setPassword(password);
      });
    } else void run(() => window.copilot.auth.verifyCode(email, code));
  };

  const title = { signin: "Welcome back", signup: "Create your account", code: "Sign in with a code", forgot: "Reset your password" }[mode];
  const subtitle = {
    signin: "Sign in to your meetings, captions and notes.",
    signup: "Free to start. Live captions and notes in any meeting, no bot joins.",
    code: "No password needed: we email you a one-time code.",
    forgot: "We'll email you a code, then you choose a new password.",
  }[mode];
  const primary = {
    signin: "Sign in",
    signup: "Create account",
    code: codeSent ? "Sign in" : "Email me a code",
    forgot: codeSent ? "Save password and sign in" : "Email me a code",
  }[mode];

  return (
    <div className="space-y-5" data-testid="login-form" data-mode={mode}>
      <div>
        {(mode === "code" || mode === "forgot") && (
          <button type="button" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" onClick={() => go("signin")}>
            <ArrowLeft size={14} aria-hidden /> Back to sign in
          </button>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>

      {(mode === "signin" || mode === "signup") && google && (
        <>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            disabled={busy && !waitingForBrowser}
            onClick={() => void continueWithGoogle()}
          >
            <GoogleIcon />
            Continue with Google
          </button>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            or
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>
        </>
      )}

      <form className="space-y-4" onSubmit={submit} noValidate>
        <label className="block text-sm font-medium">
          Email
          <input
            className={`${inputClass} mt-1`}
            type="email"
            autoComplete="email"
            aria-label="Email"
            placeholder="you@company.com"
            value={email}
            disabled={codeSent && (mode === "code" || mode === "forgot")}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {(mode === "signin" || mode === "signup") && (
          <div>
            <PasswordInput label="Password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={setPassword} />
            {mode === "signin" ? (
              <button type="button" className="mt-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => go("forgot")}>
                Forgot password?
              </button>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">At least {MIN_PASSWORD} characters.</p>
            )}
          </div>
        )}

        {codeSent && (mode === "code" || mode === "forgot") && (
          <label className="block text-sm font-medium">
            6-digit code
            <input
              className={`${inputClass} mt-1 tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Code"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
            />
          </label>
        )}
        {codeSent && mode === "forgot" && <PasswordInput label="New password" autoComplete="new-password" value={password} onChange={setPassword} />}

        {note && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200" role="status">{note}</p>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">{error}</p>}

        <button
          type="submit"
          className={`${buttonClass} w-full justify-center py-2.5`}
          disabled={busy || !validEmail || ((mode === "signin" || mode === "signup") && !password) || (codeSent && code.length < 6)}
        >
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
          {primary}
        </button>
        {codeSent && (mode === "code" || mode === "forgot") && (
          <button type="button" className="w-full text-center text-sm text-slate-500 hover:underline" disabled={busy} onClick={() => void sendCode()}>
            Didn't get it? Send a new code
          </button>
        )}
      </form>

      {mode === "signin" && (
        <button type="button" className={`${secondaryButtonClass} w-full justify-center`} onClick={() => go("code")}>
          <Mail size={15} aria-hidden /> Email me a sign-in code instead
        </button>
      )}

      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <button type="button" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => go("signin")}>Sign in</button>
          </>
        ) : (
          <>
            New here?{" "}
            <button type="button" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => go("signup")}>Create an account</button>
          </>
        )}
      </p>

      {devAvailable && (
        <button type="button" className={`${secondaryButtonClass} w-full justify-center text-xs`} disabled={busy} onClick={() => void run(() => window.copilot.auth.devSignIn())}>
          Use the local dev login
        </button>
      )}
    </div>
  );
}
