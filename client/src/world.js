'use strict';

// Client-side copy of world locations for UI display.
// Kept minimal — no server-side logic here.
const world = {
  hub: {
    id: 'hub',
    name: 'Asteria Central Station',
    type: 'station',
    coordinates: { x: 0, y: 0 },
  },
  lyra_trade_hub: {
    id: 'lyra_trade_hub',
    name: 'Lyra Trade Hub',
    type: 'station',
    coordinates: { x: 180, y: -140 },
  },
  helios_relay: {
    id: 'helios_relay',
    name: 'Helios Relay',
    type: 'station',
    coordinates: { x: -260, y: 220 },
  },
  vega_shipyard: {
    id: 'vega_shipyard',
    name: 'Vega Shipyard',
    type: 'station',
    coordinates: { x: -420, y: -120 },
  },
  asteroid_belt_a: {
    id: 'asteroid_belt_a',
    name: 'Kessler Belt — Sector A',
    type: 'mining_zone',
    coordinates: { x: 320, y: 85 },
  },
  asteroid_field_delta: {
    id: 'asteroid_field_delta',
    name: 'Delta Drifts',
    type: 'mining_zone',
    coordinates: { x: 60, y: -40 },
  },
  asteroid_field_echo: {
    id: 'asteroid_field_echo',
    name: 'Echo Scatter',
    type: 'mining_zone',
    coordinates: { x: -90, y: 30 },
  },
  asteroid_field_alpha_close: {
    id: 'asteroid_field_alpha_close',
    name: 'Alpha Close Drifts',
    type: 'mining_zone',
    coordinates: { x: 12, y: -8 },
  },
  asteroid_field_beta_close: {
    id: 'asteroid_field_beta_close',
    name: 'Beta Fringe Cluster',
    type: 'mining_zone',
    coordinates: { x: -16, y: 14 },
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
