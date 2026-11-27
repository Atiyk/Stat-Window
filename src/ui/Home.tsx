import { useId, useState, type ReactNode } from 'react';
import { isMixedSportDay } from '../content/cutover';
import type { PracticeTiming } from '../engine/game';
import type { SeasonConfig } from '../engine/season';
import type { SaveStore } from '../engine/storage';
import { formatDay } from '../lib/format';
import { track } from '../lib/track';
import { PracticeTimingChoice } from './PracticeTimingChoice';
import { WeekGlance } from './Weekly';
import { WindowDemo } from './WindowDemo';
import { hasFinishedOfficialRun } from './use-history';
import './home.css';


type Props = {
  /** No first play yet in this browser: offer the untimed walkthrough beside Play. */
  isNew?: boolean;
  /** Today's public game number from the season config (beta numbering before launch). */
  gameNumber: number;
  /** Open the untimed first-play walkthrough. */
  onLearn?: (() => void) | undefined;
  store: SaveStore;
  today: string;
  config: SeasonConfig;
  /** Start today's official five. The one dominant action. */
  onStart: () => void;
  /** Yesterday's verified score line, when there is one. */
  previous?: ReactNode;
  /** Past puzzles available to practise, newest first. Empty on launch Day 1. */
  archive: readonly string[];
  onPractice: (day: string, timing?: PracticeTiming) => void;
  onScouting: () => void;
  onWeekly: () => void;
  /** Present only when Survival is genuinely open to this player; never forced on. */
  onSurvival?: (() => void) | null | undefined;
  /** The "How to play / question types" slot. Rendered as a quiet link when provided. */
  onHowToPlay?: (() => void) | undefined;
};

/**
 * The pregame home for an unstarted official daily. The hook and a picture of the rules
 * tell a new visitor what this is in one glance; Play is the one dominant action. A new
 * player also gets a quiet way to learn first. Everything else is a quiet secondary row
 * that appears only when it has something real to show. (An unfinished daily resumes
 * directly, and a finished one shows its result, so neither passes through here.)
 */
export function Home({ isNew = false, gameNumber, onLearn, store, today, config, onStart, previous, archive, onPractice, onScouting, onWeekly, onSurvival, onHowToPlay }: Props) {
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [timing, setTiming] = useState<PracticeTiming>('timed');
  const listId = useId();
  const hasHistory = hasFinishedOfficialRun(store, today, config);

  const togglePractice = () => {
    if (!practiceOpen) track({ name: 'practice_discover', step: 'expand' });
    setPracticeOpen(!practiceOpen);
  };
  const days = showAll ? archive : archive.slice(0, 5);

  return (
    <article className="ready-card home" data-new={isNew || undefined}>
      <h1>How well do you know ball?</h1>
      <p className="home-lede">Five NBA questions a day. Frame each guess between two brackets.</p>
      <WindowDemo className="home-demo" />
      <div className="home-actions">
        <button type="button" className="btn btn-primary" onClick={onStart}>Play Game {gameNumber}</button>
        {isNew && onLearn && (
          <button type="button" className="btn btn-quiet home-learn" onClick={onLearn}>Try a practice question first</button>
        )}
      </div>
      <p className="home-terms">24 seconds a question · Free, no account</p>
      {previous}
      {/* The scoreboard is linked once, from the row in More ways to play (shown whenever this week has a game). */}
      <WeekGlance store={store} today={today} config={config} onOpen={onWeekly} link={false} />

      <nav className="home-more" aria-label="More ways to play">
        {archive.length > 0 ? (
          <div className="home-more__item">
            <button type="button" className="home-more__row" aria-expanded={practiceOpen} aria-controls={listId} onClick={togglePractice}>
              <span>Practice</span><small>Replay past games at your own pace.</small>
            </button>
            <div id={listId} className="home-practice" hidden={!practiceOpen}>
              <PracticeTimingChoice timing={timing} onChange={setTiming} />
              <ul className="archive-list">
                {days.map((day) => (
                  <li key={day}>
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => { track({ name: 'practice_discover', step: 'start' }); onPractice(day, timing); }}>
                      {formatDay(day)}
                      {isMixedSportDay(day) && <span className="archive-tag"> · mixed sports</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {archive.length > 5 && (
                <button type="button" className="btn-link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show recent games' : 'View all past games'}</button>
              )}
            </div>
          </div>
        ) : (
          <p className="home-more__empty"><span>Practice</span><small>Opens tomorrow.</small></p>
        )}
        {hasHistory && (
          <button type="button" className="home-more__row" onClick={() => { track({ name: 'scouting_open', source: 'home' }); onScouting(); }}>
            <span>Scouting Report</span><small>How you estimate, from your own games.</small>
          </button>
        )}
        {hasHistory && (
          <button type="button" className="home-more__row" onClick={() => { track({ name: 'weekly_open', source: 'home' }); onWeekly(); }}>
            <span>Weekly Scoreboard</span><small>Daily scores and weekly totals.</small>
          </button>
        )}
        {onSurvival && (
          <button type="button" className="home-more__row" onClick={onSurvival}>
            <span>Survival</span><small>20 rounds, one life.</small>
          </button>
        )}
        {onHowToPlay && (
          <button type="button" className="home-more__row" onClick={onHowToPlay}>
            <span>How to play</span><small>Rules and worked examples.</small>
          </button>
        )}
      </nav>
    </article>
  );
}
