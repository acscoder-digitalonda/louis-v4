'use client'

import { signIn } from 'next-auth/react'

export function SignInButton() {
  return (
    <button
      type="button"
      className="pill pill-accent w-full justify-center py-3"
      onClick={() => void signIn('google', { callbackUrl: '/' })}
    >
      Continue with Google
    </button>
  )
}
