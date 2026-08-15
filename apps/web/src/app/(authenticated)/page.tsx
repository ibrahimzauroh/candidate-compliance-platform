import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Overview' };

export default function OverviewPage() {
  return (
    <section className="overview" aria-labelledby="overview-title">
      <div className="overview__heading">
        <div>
          <p className="eyebrow">Authenticated foundation</p>
          <h1 id="overview-title">Your secure workspace is ready.</h1>
        </div>
        <span className="status-badge">
          <span aria-hidden="true">✓</span> Tenant context validated
        </span>
      </div>

      <div className="foundation-grid">
        <article className="foundation-card">
          <p className="foundation-card__step">01</p>
          <h2>Identity established</h2>
          <p>
            The API has validated the current authenticated identity. Session
            credentials remain outside client-side storage.
          </p>
        </article>
        <article className="foundation-card">
          <p className="foundation-card__step">02</p>
          <h2>Membership discovered</h2>
          <p>
            Tenant options came from the authenticated actor boundary without a
            caller-selected user or tenant identifier.
          </p>
        </article>
        <article className="foundation-card">
          <p className="foundation-card__step">03</p>
          <h2>Context validated</h2>
          <p>
            The selected tenant was checked against current membership before
            this shell rendered. Backend authorisation remains authoritative.
          </p>
        </article>
      </div>

      <div className="next-work-card">
        <div>
          <p className="section-label">Foundation only</p>
          <h2>Candidate workflows follow in a later phase.</h2>
        </div>
        <p>
          This screen intentionally contains no Candidate, document,
          verification or CV operations yet.
        </p>
      </div>
    </section>
  );
}
