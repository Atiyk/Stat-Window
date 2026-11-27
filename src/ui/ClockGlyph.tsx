/** A small clock face: marks a question the shot clock ended, so a timeout never reads as a plain miss. */
export function ClockGlyph({ className = 'clock-glyph' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3.4V6l1.9 1.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
