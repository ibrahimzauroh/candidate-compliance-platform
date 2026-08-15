import type { ComplianceDocument } from '@candidate-compliance/contracts';
import Link from 'next/link';

import { documentTypeLabel } from './compliance-document-list';
import { StatusBadge } from './status-badge';

interface ComplianceDocumentDetailProps {
  candidateId: string;
  document: ComplianceDocument;
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function optionalDate(value: string | null): string {
  return value
    ? dateFormatter.format(new Date(`${value}T00:00:00Z`))
    : 'Not set';
}

export function ComplianceDocumentDetail({
  candidateId,
  document,
}: ComplianceDocumentDetailProps) {
  return (
    <section className="document-detail-page">
      <Link className="back-link" href={`/candidates/${candidateId}`}>
        Back to candidate
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Compliance document</p>
          <h1>{documentTypeLabel(document.type)}</h1>
          <p>
            Read-only current-version information. Approval, correction and
            version-history actions are not available in this view.
          </p>
        </div>
        <StatusBadge status={document.currentVersion.status} />
      </div>
      <dl className="metadata-grid metadata-grid--document">
        <div>
          <dt>Current version</dt>
          <dd>{document.currentVersion.versionNumber}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{document.currentVersion.status.replace('_', ' ')}</dd>
        </div>
        <div>
          <dt>Issue date</dt>
          <dd>{optionalDate(document.currentVersion.issueDate)}</dd>
        </div>
        <div>
          <dt>Expiry date</dt>
          <dd>{optionalDate(document.currentVersion.expiryDate)}</dd>
        </div>
        <div>
          <dt>Version created</dt>
          <dd>
            <time dateTime={document.currentVersion.createdAt}>
              {dateTimeFormatter.format(
                new Date(document.currentVersion.createdAt),
              )}
            </time>
          </dd>
        </div>
        <div>
          <dt>Document updated</dt>
          <dd>
            <time dateTime={document.updatedAt}>
              {dateTimeFormatter.format(new Date(document.updatedAt))}
            </time>
          </dd>
        </div>
      </dl>
      {document.currentVersion.status === 'APPROVED' ? (
        <p className="integrity-note">
          Approved versions are immutable. Any later correction must create a
          superseding version through the governed lifecycle.
        </p>
      ) : null}
    </section>
  );
}
