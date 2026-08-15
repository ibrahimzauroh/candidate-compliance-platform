export default function DocumentLifecycleLoading() {
  return (
    <section className="candidate-loading" aria-label="Loading document">
      <p className="eyebrow">Compliance document</p>
      <h1>Loading document</h1>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <p className="sr-only" role="status">
        Loading the document and immutable version history.
      </p>
    </section>
  );
}
