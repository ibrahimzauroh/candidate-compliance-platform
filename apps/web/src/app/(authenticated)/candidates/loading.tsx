export default function CandidatesLoading() {
  return (
    <section
      className="candidate-page"
      aria-labelledby="candidate-loading-title"
    >
      <div className="state-card" role="status" aria-live="polite">
        <span className="state-card__spinner" aria-hidden="true" />
        <div>
          <h1 id="candidate-loading-title">Loading candidates</h1>
          <p>Retrieving active records for the validated tenant.</p>
        </div>
      </div>
      <div className="candidate-loading" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}
