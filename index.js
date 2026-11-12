// -----------------------------------------------------------------------------
// Entry point of the Meshtastic integration: SDK wiring only. Every handler is
// registered by src/app.js, before connect().
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
const app = registerHandlers(gladys);

// SIGTERM/SIGINT from the supervisor: close the link to the mesh and the timers,
// then the SDK disconnects cleanly and exits with code 0.
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}: shutting down`);
  app.stop();
});

logger.info('Starting the Meshtastic integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
