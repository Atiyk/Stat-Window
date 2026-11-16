-- Stat Window NBA fact database, schema v1.
-- Layers, from raw to playable:
--   sources            where a fact was checked, and what we may do with it
--   franchises/teams/players/seasons   reference entities (only those our facts touch)
--   stat_facts         one verified numeric claim about the NBA (the "fact")
--   question_candidates   an original question written about one fact
--   daily_themes / daily_slates / daily_slate_questions   the published calendar
-- There are no raw bulk statistics tables: we do not hold a licensed bulk
-- dataset (see docs/NBA_DATA_RIGHTS.md), so every row is a hand-checked fact.

PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE sources (
  id                 TEXT PRIMARY KEY,
  provider           TEXT NOT NULL,
  license            TEXT NOT NULL,
  upstream_origin    TEXT NOT NULL,
  acquisition        TEXT NOT NULL,
  attribution        TEXT NOT NULL,
  allowed_use        TEXT NOT NULL,
  review_status      TEXT NOT NULL CHECK (review_status IN ('approved', 'reference-only', 'rejected')),
  reviewed_on        TEXT NOT NULL
);

CREATE TABLE franchises (
  id            TEXT PRIMARY KEY,           -- stable code, e.g. 'LAL' (covers Minneapolis Lakers too)
  current_name  TEXT NOT NULL
);

CREATE TABLE team_names (
  franchise_id  TEXT NOT NULL REFERENCES franchises(id),
  name          TEXT NOT NULL,              -- name as used at the time, e.g. 'Seattle SuperSonics'
  PRIMARY KEY (franchise_id, name)
);

CREATE TABLE players (
  id    TEXT PRIMARY KEY,                   -- stable slug
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE seasons (
  id          TEXT PRIMARY KEY,             -- '1995-96'
  start_year  INTEGER NOT NULL,
  end_year    INTEGER NOT NULL,
  CHECK (end_year = start_year + 1)
);

CREATE TABLE stat_families (
  id           TEXT PRIMARY KEY,            -- 'team-wins', 'single-game-points', ...
  label        TEXT NOT NULL,
  first_season TEXT                          -- first season the NBA officially kept it, or NULL
);

CREATE TABLE stat_facts (
  id               TEXT PRIMARY KEY,
  claim            TEXT NOT NULL,           -- the fact in our own words
  answer           REAL NOT NULL,
  unit_singular    TEXT NOT NULL,
  unit_plural      TEXT NOT NULL,
  precision_step   REAL NOT NULL,
  stat_family      TEXT NOT NULL REFERENCES stat_families(id),
  scope            TEXT NOT NULL CHECK (scope IN ('regular-season', 'playoffs', 'finals', 'all-star', 'career', 'franchise', 'game-rules', 'draft', 'in-season-tournament', 'combined')),
  season_id        TEXT REFERENCES seasons(id),
  event_date       TEXT,                    -- YYYY-MM-DD for single games
  franchise_id     TEXT REFERENCES franchises(id),
  player_id        TEXT REFERENCES players(id),
  era              TEXT NOT NULL,           -- '1960s' ... '2020s'
  source_id        TEXT NOT NULL REFERENCES sources(id),
  source_url       TEXT NOT NULL,
  source_quote     TEXT NOT NULL,           -- short verbatim evidence excerpt (<=160 chars)
  derivation       TEXT,
  as_of            TEXT,                    -- for records that could change: date the claim was true
  verification     TEXT NOT NULL CHECK (verification IN ('verified', 'needs-review', 'rejected')),
  inspected_on     TEXT NOT NULL,
  dedupe_key       TEXT NOT NULL UNIQUE,    -- semantic key: family + subject + season/date
  version          INTEGER NOT NULL DEFAULT 1,
  UNIQUE (stat_family, answer, season_id, event_date, franchise_id, player_id)
);

CREATE TABLE question_candidates (
  id                 TEXT PRIMARY KEY,
  fact_id            TEXT NOT NULL REFERENCES stat_facts(id),
  prompt             TEXT NOT NULL UNIQUE,
  context            TEXT NOT NULL,
  reveal             TEXT NOT NULL,
  min_value          REAL NOT NULL,
  max_value          REAL NOT NULL,
  step               REAL NOT NULL,
  difficulty         TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
  difficulty_reason  TEXT NOT NULL,
  interest           INTEGER NOT NULL CHECK (interest BETWEEN 1 AND 5),
  recognizability    INTEGER NOT NULL CHECK (recognizability BETWEEN 1 AND 5),
  estimability       INTEGER NOT NULL CHECK (estimability BETWEEN 1 AND 5),
  surprise           INTEGER NOT NULL CHECK (surprise BETWEEN 1 AND 5),
  review_state       TEXT NOT NULL CHECK (review_state IN ('approved', 'draft', 'rejected')),
  reviewer           TEXT NOT NULL,
  CHECK (min_value < max_value AND step > 0)
);

CREATE TABLE question_tags (
  question_id  TEXT NOT NULL REFERENCES question_candidates(id),
  tag          TEXT NOT NULL,
  PRIMARY KEY (question_id, tag)
);

CREATE TABLE daily_themes (
  id        TEXT PRIMARY KEY,
  kind      TEXT NOT NULL CHECK (kind IN ('team-season', 'franchise', 'era', 'story', 'mixed')),
  title     TEXT NOT NULL,
  subtitle  TEXT NOT NULL,
  recap     TEXT NOT NULL
);

CREATE TABLE daily_slates (
  day             TEXT PRIMARY KEY,          -- UTC date YYYY-MM-DD
  theme_id        TEXT NOT NULL UNIQUE REFERENCES daily_themes(id),
  ramp_note       TEXT NOT NULL,
  content_hash    TEXT,                      -- sha256 of the published day file
  status          TEXT NOT NULL CHECK (status IN ('scheduled', 'published'))
);

CREATE TABLE daily_slate_questions (
  day          TEXT NOT NULL REFERENCES daily_slates(day),
  slot         INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  question_id  TEXT NOT NULL UNIQUE REFERENCES question_candidates(id),  -- a question is used on one day only
  PRIMARY KEY (day, slot)
);

CREATE INDEX idx_facts_season    ON stat_facts(season_id);
CREATE INDEX idx_facts_franchise ON stat_facts(franchise_id);
CREATE INDEX idx_facts_family    ON stat_facts(stat_family);
CREATE INDEX idx_facts_status    ON stat_facts(verification);
CREATE INDEX idx_q_difficulty    ON question_candidates(difficulty);
CREATE INDEX idx_q_review        ON question_candidates(review_state);
CREATE INDEX idx_q_fact          ON question_candidates(fact_id);
CREATE INDEX idx_tags_tag        ON question_tags(tag);
CREATE INDEX idx_slates_theme    ON daily_slates(theme_id);

-- The difficulty ladder is part of the schema: slot 1 easy, 2 medium, 3-4 hard, 5 expert.
CREATE TRIGGER slate_ladder BEFORE INSERT ON daily_slate_questions
BEGIN
  SELECT RAISE(ABORT, 'slot difficulty does not match the ladder')
  WHERE (SELECT difficulty FROM question_candidates WHERE id = NEW.question_id)
        <> CASE NEW.slot WHEN 1 THEN 'easy' WHEN 2 THEN 'medium' WHEN 5 THEN 'expert' ELSE 'hard' END;
END;

-- A stat family cannot hold a fact from before the NBA kept that stat.
CREATE TRIGGER fact_family_era BEFORE INSERT ON stat_facts
BEGIN
  SELECT RAISE(ABORT, 'stat recorded before the NBA kept it')
  WHERE NEW.season_id IS NOT NULL
    AND (SELECT first_season FROM stat_families WHERE id = NEW.stat_family) IS NOT NULL
    AND CAST(substr(NEW.season_id, 1, 4) AS INTEGER)
        < CAST(substr((SELECT first_season FROM stat_families WHERE id = NEW.stat_family), 1, 4) AS INTEGER);
END;

CREATE VIEW v_calendar AS
SELECT s.day, q.slot, c.difficulty, t.title AS theme, f.stat_family, f.season_id, f.franchise_id, c.prompt, f.answer, f.source_url
FROM daily_slates s
JOIN daily_themes t ON t.id = s.theme_id
JOIN daily_slate_questions q ON q.day = s.day
JOIN question_candidates c ON c.id = q.question_id
JOIN stat_facts f ON f.id = c.fact_id
ORDER BY s.day, q.slot;
