'use strict';

const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db/init');
const economy = require('../../config/economy.json');

const SALT_ROUNDS = 12;

const UserModel = {
  create(username, plainPassword) {
    const hash = bcrypt.hashSync(plainPassword, SALT_ROUNDS);
    const id = uuidv4();
    const stmt = db.prepare(
      'INSERT INTO users (id, username, password, credits) VALUES (?, ?, ?, ?)'
    );
    stmt.run(id, username, hash, economy.starting_balance);
    return this.findById(id);
  },

  findById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  findByOrgName(orgName) {
    return db.prepare('SELECT * FROM users WHERE org_name = ?').get(orgName);
  },

  verifyPassword(user, plainPassword) {
    return bcrypt.compareSync(plainPassword, user.password);
  },

  updateOrgName(id, orgName) {
    db.prepare('UPDATE users SET org_name = ? WHERE id = ?').run(orgName, id);
    return this.findById(id);
  },

  updateLastSeen(id) {
    db.prepare('UPDATE users SET last_seen = unixepoch() WHERE id = ?').run(id);
  },

  updateCredits(id, delta) {
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(delta, id);
  },

  listOrganizations() {
    return db.prepare(`
      SELECT org_name, COUNT(*) AS members
      FROM users
      WHERE org_name IS NOT NULL AND org_name != ''
      GROUP BY org_name
      ORDER BY org_name
    `).all();
  },

  listPlayers() {
    return db.prepare(`
      SELECT id, username, org_name, credits, last_seen
      FROM users
      ORDER BY username
    `).all();
  },
};

module.exports = UserModel;
