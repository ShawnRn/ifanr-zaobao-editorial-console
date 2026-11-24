import calendar from '../../editorial-worker/editorial_worker/publication_calendar.json'

export function isWeekendPublication(publicationDate?: string): boolean {
  if (!publicationDate) return false
  const override = calendar.overrides.find((rule) => rule.publication_date === publicationDate && 'template' in rule)
  if (override && 'template' in override) return override.template === 'weekend'
  return new Date(`${publicationDate}T00:00:00Z`).getUTCDay() === 6
}
