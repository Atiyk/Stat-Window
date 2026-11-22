import { useEffect, useRef, useState } from 'react';
/** Fictional practice value: never used as real NBA trivia or a scored round. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [lo, setLo] = useState(25);
  const [hi, setHi] = useState(75);
  const [revealed, setRevealed] = useState(false);
  const [adjusted, setAdjusted] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <article className="onboarding" aria-label="First-play tutorial">
    <p className="context">FIRST TIME HERE?</p>
    <h1 ref={heading} tabIndex={-1}>Catch the number.</h1>
    <p>Five NBA questions. Put a window around your best guess. A tighter window scores more if the answer is inside.</p>
    <section className="onboarding-demo" aria-label="Interactive practice">
      <p className="context">PRACTICE ONLY · made-up number</p>
      <p className="onboarding-prompt">A mystery player scored between 0 and 100. Can you catch the number?</p>
      <label htmlFor="tutorial-low">Low end: <strong>{lo}</strong></label>
      <input id="tutorial-low" aria-label="Practice low end" type="range" min={0} max={hi - 1} value={lo} disabled={revealed} onChange={e => { setLo(Number(e.target.value)); setAdjusted(true); }} />
      <label htmlFor="tutorial-high">High end: <strong>{hi}</strong></label>
      <input id="tutorial-high" aria-label="Practice high end" type="range" min={lo + 1} max={100} value={hi} disabled={revealed} onChange={e => { setHi(Number(e.target.value)); setAdjusted(true); }} />
      <p role="status">{revealed ? `The pretend answer was 42. ${lo <= 42 && 42 <= hi ? 'You caught it! Narrower earns more points.' : 'You missed it. A miss earns zero.'}` : adjusted ? 'Nice. Reveal the practice answer to see how your window did.' : 'Move a bracket to try it, then reveal the answer.'}</p>
    </section>
    {revealed ? <button type="button" className="btn btn-primary" onClick={onDone}>Start today's five</button> : <button type="button" className="btn btn-primary" disabled={!adjusted} onClick={() => setRevealed(true)}>Reveal practice answer</button>}
    <button type="button" className="btn btn-quiet" onClick={onDone}>Skip tutorial and start</button>
    <p className="context">Each real question has 24 seconds, starting the moment it appears.</p>
  </article>;
}
