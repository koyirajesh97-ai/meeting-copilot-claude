// The hosted Supabase project ("meeting-copilot") that the apps sign in with by default.
// Both values are public by design: the publishable key only allows what row-level security
// allows. Never put a service-role key or an AI provider key here.
export const HOSTED_SUPABASE = {
  url: "https://qxzeghownilplbryvvzl.supabase.co",
  publishableKey: "sb_publishable_8nYQPfmv_Epno_9tn7D9Hw_20tCWZny",
} as const;
