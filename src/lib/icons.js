// Movement type icons (24×24 stroked SVG paths). Each type has its own
// shape: spares go in and out of a tray, installs go in and out of a host
// (a tower), and found_installed (spec §13) is a magnifier on a host.

const TRAY = 'M4 14v5h16v-5'
const TOWER = 'M12 3h8v18h-8z M15 7h2 M15 10h2'

export const MOVEMENT_ICONS = {
  stock_in: [TRAY, 'M12 3v11', 'M8 10l4 4 4-4'],
  stock_out: [TRAY, 'M12 14V3', 'M8 7l4-4 4 4'],
  move: ['M4 8h14', 'M14 4l4 4-4 4', 'M20 16H6', 'M10 12l-4 4 4 4'],
  install: [TOWER, 'M2 12h7', 'M6 9l3 3-3 3'],
  uninstall: [TOWER, 'M9 12H2', 'M5 9l-3 3 3 3'],
  found_installed: [TOWER, 'M3 13a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M3.9 15.1L2 17'],
}

const UNKNOWN = ['M8 12h8']

export function movementIcon(type) {
  return MOVEMENT_ICONS[type] ?? UNKNOWN
}
