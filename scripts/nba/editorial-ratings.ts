/** Read-only editorial triage: a weak middle round needs a real source-reviewed rewrite, never a rating inflation. */
export type MiddleRatings = { interest: number; recognizability: number; estimability: number };
/** Rounds 2–4 are assessed separately from the stricter Q1/Q5 publication gates. */
export function middleNeedsReview(r: MiddleRatings): boolean {
  return r.interest < 3 || r.recognizability < 3 || r.estimability < 3;
}
