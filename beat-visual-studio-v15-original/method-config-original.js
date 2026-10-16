
/* ---- ACCOUNT CONFIG ------------------------------------------------------------
   Sign-in runs on Supabase Auth. Paste the project's URL and public anon key here
   (Supabase dashboard: Project Settings -> API). Both are public by design; access
   to data is enforced on the server by row-level security. Leave empty to ship
   without sign-in: the Account menu stays, and says sign-in isn't connected yet.  */
window.VYRAL_AUTH={
  url:'https://vfzqavhyuapnlfdirlhn.supabase.co',
  anonKey:'sb_publishable_awhUIXTw6p7RprXs_abZyA_OaX6kzb-',   // <- the public "publishable" (or legacy "anon") key. Never a secret / service_role key.
  apple:false,                                // Apple sign-in hidden for now (code kept for later)
  // Google's own button (Google Identity Services): Google's window then names this site, not the Supabase project.
  // The public OAuth client id Supabase uses (Google Cloud -> Credentials); this site's origin is listed there.
  googleClientId:'174464999829-85fl74se3esdkgtg16g3uq8oghh4g83h.apps.googleusercontent.com'
};

/* ---- PRIVATE BETA AUTO-LICENSE -----------------------------------------------------
   true: every account that signs in during the private beta gets the full METHOD license.
   The page asks the database function claim_private_beta_license() (method_private_beta_license.sql),
   which licenses only the signed-in account itself. false: the page never asks.
   Before public launch set it to false AND drop that function in Supabase (see the SQL file). */
const METHOD_PRIVATE_BETA_AUTO_LICENSE = true;
// TEMPORARY PRIVATE BETA AUTO-LICENSE — DISABLE BEFORE PUBLIC LAUNCH
