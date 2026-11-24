import { describe, expect, it } from 'vitest'
import { isWeekendPublication } from './publicationCalendar'

describe('调休刊期模板', () => {
  it('10 月 10 日采用工作日模板，11 日采用延期周末模板', () => {
    expect(isWeekendPublication('2026-10-10')).toBe(false)
    expect(isWeekendPublication('2026-10-11')).toBe(true)
  })
  it('其他日期保持默认模板', () => {
    expect(isWeekendPublication('2026-10-17')).toBe(true)
    expect(isWeekendPublication('2026-10-12')).toBe(false)
    expect(isWeekendPublication()).toBe(false)
  })
})
