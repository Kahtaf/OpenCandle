export function isLongInvestmentHorizon(timeHorizon: string | undefined): boolean {
  if (!timeHorizon) return false;
  const normalized = timeHorizon.toLowerCase();
  if (normalized === "long" || normalized === "long_term") return true;
  const years = normalized.match(/^(\d+)_years$/);
  return years ? Number(years[1]) >= 3 : false;
}
