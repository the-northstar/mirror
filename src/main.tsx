import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'
import { CLERK_KEY } from './lib/clerk.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Shoppers never sign in, so a missing key must not blank the app — the
        Store screen explains the setup instead. */}
    {CLERK_KEY ? (
      <ClerkProvider publishableKey={CLERK_KEY} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
)
