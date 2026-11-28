export const CONTACT_EMAIL = 'stat.window.game@gmail.com';

export function questionReportHref(date: string, position: number, questionId: string): string {
  const subject = 'Stat Window — question or scoring issue';
  const body = `Puzzle date: ${date}\nQuestion: ${position}\nQuestion ID: ${questionId}\n\nDescribe the issue (incorrect statistic, wording, chart or scoring):\n`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
