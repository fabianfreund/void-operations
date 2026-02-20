'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../../db/init');
const droneSpecs = require('../../config/drones.json');
const world = require('../../config/world.json');

const DroneModel = {
  create(ownerId, typeId, name) {
    const spec = droneSpecs[typeId];
    if (!spec) throw new Error(`Unknown drone type: ${typeId}`);

    const id = uuidv4();
    const spawn = world.hub?.coordinates ?? { x: 0, y: 0 };
    db.prepare(`
      INSERT INTO drones (id, owner_id, type_id, name, fuel_current_l, coord_x, coord_y)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, ownerId, typeId, name, spec.fuel_tank_l, spawn.x, spawn.y);

    return this.findById(id);
  },

  findById(id) {
    return db.prepare('SELECT * FROM drones WHERE id = ?').get(id);
  },

  findByOwner(ownerId) {
    return db.prepare('SELECT * FROM drones WHERE owner_id = ?').all(ownerId);
  },

  // Returns ALL active drones across all users (used by physics tick)
  findAllActive() {
    return db.prepare(
      "SELECT * FROM drones WHERE status IN ('travelling', 'mining', 'emergency')"
    ).all();
  },

  updateStatus(id, fields) {
    const sets = Object.keys(fields)
      .map((k) => `${k} = ?`)
      .join(', ');
    const values = [...Object.values(fields), id];
    db.prepare(`UPDATE drones SET ${sets} WHERE id = ?`).run(...values);
  },

  rename(id, name) {
    db.prepare('UPDATE drones SET name = ? WHERE id = ?').run(name, id);
    return this.findById(id);
  },

  addInventory(droneId, resourceId, quantityKg) {
    db.prepare(`
      INSERT INTO inventory (drone_id, resource_id, quantity_kg)
      VALUES (?, ?, ?)
      ON CONFLICT(drone_id, resource_id)
      DO UPDATE SET quantity_kg = quantity_kg + excluded.quantity_kg
    `).run(droneId, resourceId, quantityKg);
  },

  getInventory(droneId) {
    return db.prepare('SELECT * FROM inventory WHERE drone_id = ?').all(droneId);
  },

  clearInventory(droneId) {
    db.prepare('DELETE FROM inventory WHERE drone_id = ?').run(droneId);
  },

  spec(typeId) {
    return droneSpecs[typeId] ?? null;
  },
};

module.exports = DroneModel;
