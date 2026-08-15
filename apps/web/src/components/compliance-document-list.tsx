import type { ComplianceDocument } from '@candidate-compliance/contracts';
import Link from 'next/link';

import { AlertBanner } from './alert-banner';
import { EmptyState } from './empty-state';
import { StatusBadge } from './status-badge';

export type DocumentListError = 'permission' | 'unavailable';

interface ComplianceDocumentListProps {
  candidateId: string;
  documents: ComplianceDocument[];
  error?: DocumentListError;
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const typeLabels: Record<ComplianceDocument['type'], string> = {
  BACKGROUND_CHECK: 'Background check',
  OTHER: 'Other',
  PROFESSIONAL_CERTIFICATION: 'Professional certification',
  RIGHT_TO_WORK: 'Right to Work',
};

function dateLabel(value: string | null): string {
  return value
    ? dateFormatter.format(new Date(`${value}T00:00:00Z`))
    : 'Not set';
}

export function documentTypeLabel(type: ComplianceDocument['type']): string {
  return typeLabels[type];
}

export function ComplianceDocumentList({
  candidateId,
  documents,
  error,
}: ComplianceDocumentListProps) {
  if (error) {
    return (
      <AlertBanner
        title={
          error === 'permission'
            ? 'Document access unavailable'
            : 'Documents unavailable'
        }
        tone="error"
      >
        <p>
          {error === 'permission'
            ? 'You do not have permission to view compliance documents in this tenant.'
            : 'Compliance documents could not be loaded. Please try again.'}
        </p>
      </AlertBanner>
    );
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        title="No compliance documents"
        description="Add the first compliance document for this candidate. New documents begin as drafts."
        action={
          <Link
            className="button button--primary"
            href={`/candidates/${candidateId}/documents/new`}
          >
            Add document
          </Link>
        }
      />
    );
  }

  return (
    <div className="document-list-region">
      <div className="document-list__header" aria-hidden="true">
        <span>Document</span>
        <span>Status</span>
        <span>Expiry</span>
        <span>Action</span>
      </div>
      <ul className="document-list">
        {documents.map((document) => (
          <li className="document-record" key={document.id}>
            <dl className="document-record__fields">
              <div>
                <dt className="sr-only document-record__mobile-label">
                  Document
                </dt>
                <dd>
                  <strong>{documentTypeLabel(document.type)}</strong>
                  <span>Version {document.currentVersion.versionNumber}</span>
                </dd>
              </div>
              <div>
                <dt className="sr-only document-record__mobile-label">
                  Status
                </dt>
                <dd>
                  <StatusBadge status={document.currentVersion.status} />
                </dd>
              </div>
              <div>
                <dt className="sr-only document-record__mobile-label">
                  Expiry
                </dt>
                <dd>
                  {document.currentVersion.expiryDate ? (
                    <time dateTime={document.currentVersion.expiryDate}>
                      {dateLabel(document.currentVersion.expiryDate)}
                    </time>
                  ) : (
                    'Not set'
                  )}
                </dd>
              </div>
              <div className="document-record__action">
                <dt className="sr-only">Action</dt>
                <dd>
                  <Link
                    className="button button--quiet"
                    href={`/candidates/${candidateId}/documents/${document.id}`}
                    aria-label={`View ${documentTypeLabel(document.type)}`}
                  >
                    View
                  </Link>
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
