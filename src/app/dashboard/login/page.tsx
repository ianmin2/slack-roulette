'use client';

const LoginPage = () => (
  <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
    <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white px-8 py-10 shadow-sm">
      {/* Logo / Brand */}
      <div className="flex flex-col items-center">
        <svg className="h-10 w-10 text-slate-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
        <h1 className="mt-4 text-xl font-bold text-gray-900">PR Roulette</h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          Sign in to access the review dashboard
        </p>
      </div>

      {/* Divider */}
      <div className="my-8 border-t border-gray-100" />

      {/* Sign in with Slack button */}
      <a
        href="/api/auth/slack"
        className="flex w-full items-center justify-center gap-3 rounded-lg bg-[#4A154B] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#3b1139] focus:outline-none focus:ring-2 focus:ring-[#4A154B] focus:ring-offset-2"
      >
        {/* Slack logo */}
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
        </svg>
        Sign in with Slack
      </a>

      {/* Footer note */}
      <p className="mt-6 text-center text-xs text-gray-400">
        Uses your Slack workspace identity. No password required.
      </p>
    </div>
  </div>
);

export default LoginPage;
