import type { ComplianceDocument } from '@candidate-compliance/contracts';

type ComplianceDocumentStatus = ComplianceDocument['currentVersion']['status'];

const statusLabels: Record<ComplianceDocumentStatus, string> = {
  APPROVED: 'Approved',
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending review',
  REJECTED: 'Rejected',
};

export function StatusBadge({ status }: { status: ComplianceDocumentStatus }) {
  return (
    <span className={`status-badge status-badge--${status.toLowerCase()}`}>
      {statusLabels[status]}
    </span>
  );
}
