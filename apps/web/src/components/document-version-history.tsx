import type { ComplianceDocumentVersionHistoryResponse } from '@candidate-compliance/contracts';

import { AlertBanner } from './alert-banner';
import { StatusBadge } from './status-badge';

interface DocumentVersionHistoryProps {
  error?: string | null;
  history?: ComplianceDocumentVersionHistoryResponse;
  loading?: boolean;
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

export function DocumentVersionHistory({
  error,
  history,
  loading = false,
}: DocumentVersionHistoryProps) {
  return (
    <section
      className="version-history"
      aria-labelledby="version-history-title"
    >
      <div className="section-heading">
        <div>
          <p className="section-label">Governed record</p>
          <h2 id="version-history-title">Version history</h2>
        </div>
        <p>Stored versions are read-only.</p>
      </div>

      {loading ? (
        <div className="state-card" role="status" aria-live="polite">
          <span className="state-card__spinner" aria-hidden="true" />
          <div>
            <h3>Refreshing history</h3>
            <p>Loading the authoritative version record.</p>
          </div>
        </div>
      ) : error ? (
        <AlertBanner title="Version history unavailable" tone="error">
          <p>{error}</p>
        </AlertBanner>
      ) : history ? (
        <ol className="version-history__list">
          {history.items.map((version) => (
            <li
              className={`version-record${version.isCurrent ? ' version-record--current' : ''}`}
              key={version.id}
            >
              <div className="version-record__heading">
                <div>
                  <h3>Version {version.versionNumber}</h3>
                  <p>
                    {version.isCurrent
                      ? 'Current version'
                      : 'Historical version — read-only'}
                  </p>
                </div>
                <StatusBadge status={version.status} />
              </div>
              <dl className="version-record__metadata">
                <div>
                  <dt>Issue date</dt>
                  <dd>{optionalDate(version.issueDate)}</dd>
                </div>
                <div>
                  <dt>Expiry date</dt>
                  <dd>{optionalDate(version.expiryDate)}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>
                    <time dateTime={version.createdAt}>
                      {dateTimeFormatter.format(new Date(version.createdAt))}
                    </time>
                  </dd>
                </div>
              </dl>
              {version.status === 'APPROVED' ? (
                <p className="version-record__integrity">
                  Immutable approved version
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
