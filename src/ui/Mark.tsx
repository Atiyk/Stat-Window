/** The mark: a ruler with a highlighted window held between two brackets. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" fill="var(--violet)" />
      <rect x="11" y="9" width="10" height="14" fill="var(--hi)" />
      <path d="M9 7H6v18h3M23 7h3v18h-3" stroke="var(--paper)" strokeWidth="2.5" fill="none" />
    </svg>
  );
}
