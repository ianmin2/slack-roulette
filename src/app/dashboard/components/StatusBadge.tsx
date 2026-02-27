'use client';

import type { AssignmentStatus } from '@/types/dashboard';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: AssignmentStatus;
}

const STATUS_CONFIG: Record<AssignmentStatus, { label: string; className: string }> = {
  PENDING: {
    label: 'Pending',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  },
  ASSIGNED: {
    label: 'Assigned',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  IN_REVIEW: {
    label: 'In Review',
    className: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  APPROVED: {
    label: 'Approved',
    className: 'bg-green-100 text-green-800 border-green-200',
  },
  CHANGES_REQUESTED: {
    label: 'Changes Requested',
    className: 'bg-red-100 text-red-800 border-red-200',
  },
  COMPLETED: {
    label: 'Completed',
    className: 'bg-gray-100 text-gray-800 border-gray-200',
  },
  SKIPPED: {
    label: 'Skipped',
    className: 'bg-gray-100 text-gray-500 border-gray-200',
  },
  EXPIRED: {
    label: 'Expired',
    className: 'bg-gray-100 text-gray-400 border-gray-200',
  },
};

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    className: 'bg-gray-100 text-gray-800 border-gray-200',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        config.className,
      )}
    >
      {config.label}
    </span>
  );
};
