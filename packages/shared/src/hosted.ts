// The apps' built-in server and sign-in settings, from config/client.json (the one place to
// change them). Public values only; never put a service-role key or an AI key there.
import client from "../../../config/client.json";

export const HOSTED_SUPABASE = {
  url: client.supabaseUrl,
  publishableKey: client.supabasePublishableKey,
} as const;

/** The hosted backend, or "" when each person enters their own server. */
export const HOSTED_BACKEND_URL: string = client.backendUrl;
