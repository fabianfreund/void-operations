'use strict';

/**
 * Mining System
 *
 * Higher-level mining management: validates operations, handles
 * selling cargo at markets, and tracks resource economics.
 */

const DroneModel = require('../models/drone');
const UserModel = require('../models/user');
const world = require('../../config/world.json');
const economy = require('../../config/economy.json');
const { dispatchMine } = require('./physics');

const MiningSystem = {
  /**
   * Start a mining operation for a drone.
   * Returns { ok: true } or { ok: false, error: string }
   */
  startMining(droneId) {
    const err = dispatchMine(droneId);
    if (err) return { ok: false, error: err };
    return { ok: true };
  },

  /**
   * Sell all cargo from a drone at the current location's market.
   * Credits are added to the owning user's account.
   * Returns { ok: true, credits: number, sold: [] } or { ok: false, error }
   */
  sellCargo(droneId) {
    const drone = DroneModel.findById(droneId);
    if (!drone) return { ok: false, error: 'Drone not found.' };
    if (drone.status !== 'idle') return { ok: false, error: 'Drone must be idle to sell cargo.' };

    const location = world[drone.location_id];
    if (!location?.has_market) {
      return { ok: false, error: 'No market at current location.' };
    }

    const inventory = DroneModel.getInventory(droneId);
    if (!inventory.length) return { ok: false, error: 'No cargo to sell.' };

    let totalCredits = 0;
    const sold = [];

    for (const item of inventory) {
      const resource = economy.resources[item.resource_id];
      if (!resource) continue;

      // Apply random price volatility
      const priceVariance = 1 + (Math.random() * 2 - 1) * resource.volatility;
      const unitPrice = resource.base_price * priceVariance;
      const gross = unitPrice * item.quantity_kg;
      const net = gross * (1 - economy.market_tax_rate);

      totalCredits += net;
      sold.push({
        resource: resource.name,
        quantity_kg: item.quantity_kg,
        unit_price: parseFloat(unitPrice.toFixed(2)),
        net_credits: parseFloat(net.toFixed(2)),
      });
    }

    totalCredits = parseFloat(totalCredits.toFixed(2));
    UserModel.updateCredits(drone.owner_id, totalCredits);
    DroneModel.clearInventory(droneId);

    return { ok: true, credits: totalCredits, sold };
  },

  /**
   * Refuel a drone at a station. Deducts credits from owner.
   */
  refuel(droneId, litres) {
    const drone = DroneModel.findById(droneId);
    if (!drone) return { ok: false, error: 'Drone not found.' };
    if (drone.status !== 'idle') return { ok: false, error: 'Drone must be idle to refuel.' };

    const location = world[drone.location_id];
    if (!location?.has_refuel) return { ok: false, error: 'No refueling available here.' };

    const spec = DroneModel.spec(drone.type_id);
    const maxFill = spec.fuel_tank_l - drone.fuel_current_l;
    const actualLitres = Math.min(litres, maxFill);

    if (actualLitres <= 0) return { ok: false, error: 'Fuel tank already full.' };

    const cost = parseFloat((actualLitres * economy.fuel_price_per_l).toFixed(2));
    const owner = UserModel.findById(drone.owner_id);
    if (owner.credits < cost) {
      return { ok: false, error: `Insufficient credits. Need ${cost}, have ${owner.credits.toFixed(2)}.` };
    }

    UserModel.updateCredits(drone.owner_id, -cost);
    DroneModel.updateStatus(droneId, {
      fuel_current_l: parseFloat((drone.fuel_current_l + actualLitres).toFixed(3)),
    });

    return { ok: true, litres_added: actualLitres, cost };
  },
};

module.exports = MiningSystem;
