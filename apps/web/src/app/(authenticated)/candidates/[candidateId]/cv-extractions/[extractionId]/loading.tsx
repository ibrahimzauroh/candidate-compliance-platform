export default function CvProposalLoading() {
  return (
    <section className="candidate-loading" aria-label="Loading CV proposal">
      <p className="eyebrow">Governed CV extraction</p>
      <h1>Loading CV proposal</h1>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <p className="sr-only" role="status">
        Loading the advisory CV proposal for recruiter review.
      </p>
    </section>
  );
}
