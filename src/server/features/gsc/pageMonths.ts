/** One calendar month of Search Console data, as YYYY-MM-DD bounds. */
type GscMonth = {
  /** YYYY-MM */
  month: string;
  startDate: string;
  endDate: string;
  /** The current month, still in progress. */
  partial: boolean;
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The last 12 calendar months, oldest first, the current month to today. */
export function lastTwelveMonths(today: Date): GscMonth[] {
  const months: GscMonth[] = [];
  for (let back = 11; back >= 0; back--) {
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1),
    );
    const monthEnd = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
    );
    const partial = back === 0;
    months.push({
      month: isoDay(start).slice(0, 7),
      startDate: isoDay(start),
      endDate: isoDay(partial ? today : monthEnd),
      partial,
    });
  }
  return months;
}
