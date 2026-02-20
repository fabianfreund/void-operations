'use strict';

/**
 * dashboard.js — barrel re-export of all UI modules.
 *
 * Adding a new page:
 *   1. Create client/src/ui/pages/<your-page>.js
 *      - Import { term, clearContent, renderLog } from '../layout'
 *      - Call clearContent(4) at the top of each render function
 *      - Call renderLog() / renderDroneLog(id) at the end
 *   2. Re-export its functions here
 */

const layout = require('./layout');
const mainMenu = require('./pages/main-menu');
const fleet = require('./pages/fleet');
const drone = require('./pages/drone');
const admin = require('./pages/admin');
const status = require('./pages/status');
const settings = require('./pages/settings');

module.exports = {
  // layout primitives
  addLog: layout.addLog,
  renderHeader: layout.renderHeader,
  startProgressTracking: layout.startProgressTracking,
  stopProgressTracking: layout.stopProgressTracking,
  waitForBack: layout.waitForBack,
  toggleLogSidebar: layout.toggleLogSidebar,
  isLogSidebarEnabled: layout.isLogSidebarEnabled,

  // main menu
  showMainMenu: mainMenu.showMainMenu,

  // fleet pages
  renderFleetTable: fleet.renderFleetTable,
  showDroneSelector: fleet.showDroneSelector,
  showLocationSelector: fleet.showLocationSelector,
  renderScanResults: fleet.renderScanResults,
  renderCommandResult: fleet.renderCommandResult,

  // drone pages
  showDroneActionMenu: drone.showDroneActionMenu,
  showDroneCommandMenu: drone.showDroneCommandMenu,
  renderDroneDetail: drone.renderDroneDetail,

  // admin pages
  showAdminMenu: admin.showAdminMenu,
  renderOrganizations: admin.renderOrganizations,
  renderPlayers: admin.renderPlayers,
  promptOrganizationName: admin.promptOrganizationName,

  // status page
  renderOverallStatus: status.renderOverallStatus,

  // settings
  showSettingsMenu: settings.showSettingsMenu,
};
