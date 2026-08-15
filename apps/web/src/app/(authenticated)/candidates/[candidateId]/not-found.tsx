import Link from 'next/link';

export default function CandidateResourceNotFound() {
  return (
    <section className="candidate-page" aria-labelledby="not-found-title">
      <p className="eyebrow">Tenant-scoped record</p>
      <h1 id="not-found-title">Record not available</h1>
      <p>
        The Candidate or compliance document is unavailable in the selected
        tenant.
      </p>
      <Link className="button button--secondary" href="/candidates">
        Return to candidates
      </Link>
    </section>
  );
}
