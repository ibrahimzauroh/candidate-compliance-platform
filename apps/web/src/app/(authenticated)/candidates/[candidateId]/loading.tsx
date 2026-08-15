export default function CandidateDetailLoading() {
  return (
    <section
      className="candidate-loading"
      aria-labelledby="candidate-loading-title"
    >
      <p className="eyebrow">Candidate record</p>
      <h1 id="candidate-loading-title">Loading candidate</h1>
      <p role="status" aria-live="polite">
        Loading Candidate details and compliance documents.
      </p>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </section>
  );
}
