import { useId } from 'react';
import type { PracticeTiming } from '../engine/game';
import './practice-timing.css';

const options = [
  { timing: 'timed', label: 'Timed' },
  { timing: 'untimed', label: 'Untimed' },
] as const;

export function PracticeTimingChoice({ timing, onChange }: {
  timing: PracticeTiming;
  onChange: (timing: PracticeTiming) => void;
}) {
  const group = useId();
  return (
    <fieldset className="practice-timing">
      <legend>Practice timing</legend>
      {options.map((option) => (
        <label key={option.timing} className="practice-timing-option">
          <input
            type="radio"
            name={group}
            value={option.timing}
            checked={timing === option.timing}
            onChange={() => onChange(option.timing)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
