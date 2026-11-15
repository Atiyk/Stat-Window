/** The mark: two caliper brackets closing on the answer. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M11 5H5v22h6M21 5h6v22h-6" stroke="var(--brand)" strokeWidth="3.5" fill="none" strokeLinejoin="round" />
      <rect x="14.25" y="9" width="3.5" height="14" rx="1.75" fill="var(--ink)" />
    </svg>
  );
}
