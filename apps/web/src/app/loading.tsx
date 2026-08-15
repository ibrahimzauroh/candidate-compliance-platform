export default function Loading() {
  return (
    <main className="centered-page" id="main-content">
      <div className="state-card" role="status" aria-live="polite">
        <span className="state-card__spinner" aria-hidden="true" />
        <div>
          <h1>Loading Candidate Compliance</h1>
          <p>Validating your secure workspace.</p>
        </div>
      </div>
    </main>
  );
}
