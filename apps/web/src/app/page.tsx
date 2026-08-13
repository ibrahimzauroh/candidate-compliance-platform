export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <section className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-10 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-800">
          Operations console
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
          Candidate Compliance Platform
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
          The application foundation is ready. Candidate and compliance
          workflows will be added in later phases.
        </p>
      </section>
    </main>
  );
}
