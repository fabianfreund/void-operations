'use strict';

// Client-side copy of world locations for UI display.
// Kept minimal — no server-side logic here.
const world = {
  hub: {
    id: 'hub',
    name: 'Orbital Hub Alpha',
    type: 'station',
    coordinates: { x: 0, y: 0 },
  },
  asteroid_belt_a: {
    id: 'asteroid_belt_a',
    name: 'Kessler Belt — Sector A',
    type: 'mining_zone',
    coordinates: { x: 320, y: 85 },
  },
  asteroid_belt_b: {
    id: 'asteroid_belt_b',
    name: 'Kessler Belt — Sector B',
    type: 'mining_zone',
    coordinates: { x: 410, y: 200 },
  },
  deep_void_outpost: {
    id: 'deep_void_outpost',
    name: 'Deep Void Outpost',
    type: 'outpost',
    coordinates: { x: 780, y: 430 },
  },
};

module.exports = world;
