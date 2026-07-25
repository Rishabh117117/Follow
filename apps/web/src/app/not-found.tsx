import Link from 'next/link'

export default function NotFound() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4"
      style={{ backgroundColor: 'var(--n100)' }}
    >
      <div className="w-full max-w-[400px] text-center">
        {/* Brand */}
        <div className="mb-10 flex items-center justify-center gap-2.5">
          <div
            className="flex h-5 w-5 items-center justify-center rounded-[3px]"
            style={{ backgroundColor: 'var(--n950)' }}
          >
            <span className="text-[11px] font-bold leading-none text-white">F</span>
          </div>
          <span
            className="text-[22px] leading-none"
            style={{
              fontFamily: 'Newsreader, Georgia, serif',
              color: 'var(--n950)',
              fontWeight: 500,
            }}
          >
            Follow
          </span>
        </div>

        <div
          className="rounded-xl border bg-white p-10 shadow-sm"
          style={{ borderColor: 'var(--n200)' }}
        >
          <h1
            className="mb-3 text-[28px] leading-tight"
            style={{
              fontFamily: 'Newsreader, Georgia, serif',
              color: 'var(--n950)',
              fontWeight: 500,
            }}
          >
            Page not found
          </h1>
          <p className="mb-8 text-[13px]" style={{ color: 'var(--n500)' }}>
            The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-[13px] font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--n950)' }}
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
