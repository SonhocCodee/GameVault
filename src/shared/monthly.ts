export const FIRST_RANKING_MONTH = "2026-11";
export const MONTHLY_TIMEZONE = "Asia/Ho_Chi_Minh";
export const RATING_PRIOR_SCORE = 7;
export const RATING_PRIOR_WEIGHT = 5;

export function currentRankingMonth(now = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

export function rankingMonthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, number] = month.split("-").map(Number);
  if (year < 2026) return null;
  return {
    start: Date.UTC(year, number - 1, 1, -7),
    end: Date.UTC(year, number, 1, -7),
  };
}

export function rankingMonths(current: string): string[] {
  if (!rankingMonthBounds(current) || current < FIRST_RANKING_MONTH) return [];
  const result: string[] = [];
  let month = current;
  while (month >= FIRST_RANKING_MONTH) {
    result.push(month);
    const [year, number] = month.split("-").map(Number);
    month = `${number === 1 ? year - 1 : year}-${String(number === 1 ? 12 : number - 1).padStart(2, "0")}`;
  }
  return result;
}

export function monthlyRatingScore(average: number, count: number): number {
  if (!Number.isFinite(average) || !Number.isFinite(count) || count < 1) return 0;
  return (average * count + RATING_PRIOR_SCORE * RATING_PRIOR_WEIGHT) /
    (count + RATING_PRIOR_WEIGHT);
}
