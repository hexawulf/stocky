import { describe, expect, it } from 'vitest'
import { MOVEMENT_ICONS, movementIcon } from './icons.js'
import { MOVEMENT_TYPES } from './movements.js'

describe('movement icons', () => {
  it('every movement type has its own icon, including found_installed (spec §13)', () => {
    const types = [...new Set([...MOVEMENT_TYPES.map((t) => t.value), 'found_installed'])]
    for (const t of types) expect(MOVEMENT_ICONS[t], t).toBeDefined()
    const shapes = new Set(types.map((t) => movementIcon(t).join(' ')))
    expect(shapes.size).toBe(types.length)
  })

  it('install is not drawn like stock in (host vs tray)', () => {
    expect(movementIcon('install')[0]).not.toBe(movementIcon('stock_in')[0])
  })

  it('an unknown type still gets an icon', () => {
    expect(movementIcon('nope').length).toBeGreaterThan(0)
  })
})
