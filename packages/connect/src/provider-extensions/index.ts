import type { ProviderRegistration } from '../registry.js';
import { applyAllowTools } from '../toolset.js';
import { createNeonExtensionTools } from './neon/index.js';

export function extendProviderRegistration(provider: ProviderRegistration): ProviderRegistration {
  if (provider.integrationId !== 'neon') return provider;

  return {
    ...provider,
    createTools: options => {
      const generated = provider.createTools({ ...options, allowTools: undefined });
      const extensions = createNeonExtensionTools(options);
      return applyAllowTools({ ...generated, ...extensions }, options?.allowTools);
    },
  };
}
