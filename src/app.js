// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake
// Gladys), so index.js stays a few lines and the tests drive the very same
// wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { loadClientId } from './clientId.js';
import { normalizeConfig } from './config.js';
import { Hub } from './hub.js';
import { MESSAGES } from './texts.js';
import { SCENE_ACTION, sendMessage } from './scenes.js';
import { WIDGET, getMeshWidget, onMeshAction } from './widgets.js';

const logger = createLogger({ name: 'meshtastic-app' });

export const ACTION = {
  CHECK_CONNECTION: 'check_connection',
};

/**
 * @param {object} gladys
 * @param {object} [options] test seams: connectMqtt, connectTcp, loadClientId, now, timings
 * @returns {{ hub: Hub, stop: () => void }}
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new Hub({
    gladys,
    now: options.now,
    connectMqtt: options.connectMqtt,
    connectTcp: options.connectTcp,
    loadClientId: options.loadClientId ?? (() => loadClientId()),
    timings: options.timings,
  });

  // --- Discovery: the nodes of the mesh -----------------------------------------
  gladys.onScanRequest(async () => {
    logger.info('Scan requested');
    await hub.loadHome();
    await hub.publishDiscovery({ force: true });
  });

  // --- Read-only devices -------------------------------------------------------
  gladys.onSetValue(async (device, feature) => {
    throw new Error(`${feature.external_id} is read-only`);
  });

  // No poll: the mesh pushes. Registered anyway, for a device that would have
  // been created with polling: nothing to do.
  gladys.onPoll(async () => {});

  // A device just added or updated in Gladys: the SDK forgot what it had
  // published and the core dropped the states sent before it existed. Send
  // everything now, and refresh the open widgets (its name may have changed).
  const onDeviceChanged = async () => {
    await hub.republish();
    hub.requestWidgetRefresh();
  };
  gladys.onDeviceCreated(onDeviceChanged);
  gladys.onDeviceUpdated(onDeviceChanged);
  gladys.onDeviceDeleted(async () => {
    hub.requestWidgetRefresh();
  });

  // --- Configuration screen action ----------------------------------------------
  gladys.onAction(ACTION.CHECK_CONNECTION, async () => {
    logger.info('Action check_connection');
    return hub.checkConnection();
  });

  // --- Scene action ---------------------------------------------------------------
  gladys.onSceneAction(SCENE_ACTION.SEND_MESSAGE, async (fields) => {
    logger.info('Scene action send_message');
    return sendMessage(hub, fields);
  });

  // --- Dashboard widget -----------------------------------------------------------
  gladys.onWidgetGet(WIDGET.MESH, (request) => getMeshWidget(hub, request));
  gladys.onWidgetAction(WIDGET.MESH, async (actionKey, params, context) => {
    logger.info(`Widget action ${actionKey}`);
    return onMeshAction(hub, actionKey, params, context);
  });

  // --- Configuration -------------------------------------------------------------
  // A configuration saved while the initial getConfig() is in flight wins
  // over the (older) values it returns.
  let configUpdates = 0;
  gladys.onConfigUpdated(async (raw) => {
    configUpdates += 1;
    logger.info('Configuration updated');
    await hub.configure(normalizeConfig(raw));
  });

  // --- Connection lifecycle (the SDK logs the Gladys link itself) -------------
  gladys.on('connected', async () => {
    try {
      const updates = configUpdates;
      const raw = await gladys.getConfig();
      if (updates !== configUpdates) {
        return;
      }
      await hub.loadHome();
      await hub.configure(normalizeConfig(raw));
    } catch (err) {
      logger.error(`Post-connection initialization failed: ${err.message}`);
      await gladys.setConnectionStatus(false, MESSAGES.publishFailed).catch(() => {});
    }
  });

  return {
    hub,
    stop() {
      hub.stop();
    },
  };
}
