'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const availableNavigation = [
  { href: '/', label: 'Overview' },
  { href: '/candidates', label: 'Candidates' },
];

const futureNavigation = ['Documents', 'Verifications', 'CV review'];

export function PrimaryNavigation() {
  const pathname = usePathname();

  return (
    <nav className="primary-nav" aria-label="Primary navigation">
      {availableNavigation.map((item) => {
        const isCurrent =
          item.href === '/'
            ? pathname === '/'
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrent ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
      {/* hiding these for now, to avoid confusion */}
      {/* {futureNavigation.map((item) => (
        <span key={item} aria-disabled="true" title="Planned for a later phase">
          {item}
        </span>
      ))} */}
    </nav>
  );
}
