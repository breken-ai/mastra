// AUTO-GENERATED from rhysbalevicius/integration-templates @ e15a84f3714d — do not edit by hand.
import type { ProviderRegistration } from '../../registry.js';
import { createIncidentIoTools } from './tools.js';

export const incidentIoProvider: ProviderRegistration = {
  integrationId: 'incident-io',
  envVar: 'MASTRA_INCIDENT_IO_CONNECTION_ID',
  createTools: createIncidentIoTools,
};

export { createIncidentIoTools };
