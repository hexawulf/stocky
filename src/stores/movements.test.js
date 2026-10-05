import { describe, expect, it } from 'vitest'
import { buildMovementFilter } from './movements.js'

describe('buildMovementFilter (decision #22: History filters on the server)', () => {
  it('no filters -> empty', () => {
    expect(buildMovementFilter({})).toBe('')
  })

  it('combines type, part, date range and place (OR over the four relations)', () => {
    const f = buildMovementFilter({
      type: 'move',
      part: 'p1',
      place: 'lab',
      from: '2026-10-01',
      to: '2026-10-04',
    })
    expect(f).toBe(
      'type = "move" && part = "p1" && (fromLocation = "lab" || fromHost = "lab" || toLocation = "lab" || toHost = "lab") && date >= "2026-10-01" && date <= "2026-10-04"',
    )
  })

  it('escapes values instead of splicing them in (pb.filter quotes with ")', () => {
    expect(buildMovementFilter({ part: 'x" || user != "' })).toBe('part = "x\\" || user != \\""')
  })
})
