/** Publishable key. Public by design — the secret key stays server-side. */
export const CLERK_KEY: string | undefined = import.meta.env
  .VITE_CLERK_PUBLISHABLE_KEY
