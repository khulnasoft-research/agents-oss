import "server-only";

interface EnvCustomProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
}

function readEnvProviders(): EnvCustomProvider[] {
  const providers: EnvCustomProvider[] = [];

  // Support up to 5 custom providers via env vars
  for (let i = 1; i <= 5; i++) {
    const suffix = i === 1 ? "" : `_${i}`;
    const url = process.env[`CUSTOM_PROVIDER${suffix}_URL`];
    const key = process.env[`CUSTOM_PROVIDER${suffix}_KEY`];
    const name = process.env[`CUSTOM_PROVIDER${suffix}_NAME`];

    if (url && key && name) {
      providers.push({ name, baseUrl: url, apiKey: key });
    }
  }

  // Also support named providers (CUSTOM_PROVIDER_OPENROUTER_URL, etc.)
  const knownProviders = ["openrouter", "kilo", "opencode", "zen"];
  for (const provider of knownProviders) {
    const prefix = `CUSTOM_PROVIDER_${provider.toUpperCase()}`;
    const url = process.env[`${prefix}_URL`];
    const key = process.env[`${prefix}_KEY`];
    const name = process.env[`${prefix}_NAME`];

    if (url && key) {
      // Avoid duplicates if already added via numbered slots
      const alreadyAdded = providers.some(
        (p) => p.baseUrl === url && p.apiKey === key,
      );
      if (!alreadyAdded) {
        providers.push({
          name: name ?? provider.charAt(0).toUpperCase() + provider.slice(1),
          baseUrl: url,
          apiKey: key,
        });
      }
    }
  }

  return providers;
}

export function getEnvCustomProviders(): EnvCustomProvider[] {
  return readEnvProviders();
}
