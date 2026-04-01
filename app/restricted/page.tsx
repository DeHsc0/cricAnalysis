import Link from "next/link";

export default function RestrictedPage() {

  return (
    <section
      className="min-h-screen w-full px-6 py-10 flex items-center justify-center"
      style={{
        background:
          "linear-gradient(rgba(10, 15, 29, 0.55), rgba(10, 15, 29, 0.9)), radial-gradient(circle at 20% 20%, rgba(59, 130, 246, 0.2), transparent 50%), #0a0f1d",
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900/70 p-8 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl">
        <p className="text-xs font-semibold tracking-[0.16em] text-slate-400 uppercase">
          Access Control
        </p>

        <h1 className="mt-3 text-3xl font-semibold text-white leading-tight">
          This page is restricted
        </h1>

        <p className="mt-3 text-sm text-slate-300">
          Your current account does not have permission to view this route. Please
          reauthenticate with an authorized account or return to your allowed
          dashboard section.
        </p>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg bg-linear-to-br from-blue-400 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(59,130,246,0.35)] transition-all duration-300 hover:-translate-y-0.5 hover:from-blue-500 hover:to-blue-700"
          >
            Reauthenticate
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-slate-950/60 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/80"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}
