import type { Metadata } from 'next';
import Link from 'next/link';

import { CandidateForm } from '../../../../components/candidate-form';

export const metadata: Metadata = { title: 'Add candidate' };

export default function AddCandidatePage() {
  return (
    <section
      className="candidate-create-page"
      aria-labelledby="candidate-create-title"
    >
      <Link className="back-link" href="/candidates">
        Back to candidates
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">New active record</p>
          <h1 id="candidate-create-title">Add candidate</h1>
          <p>
            Create the candidate record first. Compliance documents and other
            workflows remain separate, explicit operations.
          </p>
        </div>
      </div>
      <div className="candidate-form-card">
        <CandidateForm />
      </div>
    </section>
  );
}
