import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { isIP } from "node:net";
import { z } from "zod";
import { db } from "./db/client";
import { customProviders, type CustomProvider } from "./db/schema";

export type { CustomProvider } from "./db/schema";

/**
 * Built-in provider prefixes served by the deployment's own gateway. A custom
 * provider using one of these would shadow identical built-in model ids (e.g.
 * "openai/gpt-5.4") in the selector and hijack default model traffic.
 */
const BUILT_IN_PROVIDER_PREFIXES = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "groq",
  "mistral",
  "deepseek",
  "perplexity",
  "moonshot",
  "togetherai",
  "cohere",
  "fireworks",
  "meta",
  "zai",
] as const;

/** Unresolvable / non-routable hostnames that must never be fetched from
 * server-side code (SSRF guard). Hostname-based checks cannot cover
 * DNS-rebinding or custom-resolving hosts; that boundary is enforced at the
 * platform egress level. */
const BLOCKED_INTERNAL_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
] as const;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast + reserved
  );
}

function isPrivateIpv6(address: string): boolean {
  // IPv4-mapped addresses (::ffff:192.168.0.1) reuse the IPv4 ranges
  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  return (
    address === "::" ||
    address === "::1" ||
    /^fc[\da-f]/i.test(address) || // fc00::/7 unique local
    /^fd[\da-f]/i.test(address) ||
    /^fe[89ab][\da-f]:/i.test(address) // fe80::/10 link-local
  );
}

export function isBlockedCustomProviderBaseUrl(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return true;
  }

  if (url.protocol !== "https:") {
    return true;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    BLOCKED_INTERNAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return true;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return isPrivateIpv4(hostname);
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(hostname);
  }

  return false;
}

const CUSTOM_PROVIDER_NAME_PATTERN = /^[\p{L}\p{N} _-]+$/u;

export const customProviderSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(
        CUSTOM_PROVIDER_NAME_PATTERN,
        "Only letters, numbers, spaces, underscores, and hyphens are allowed",
      ),
    baseUrl: z
      .string()
      .url()
      .refine((value) => !isBlockedCustomProviderBaseUrl(value), {
        message: "Base URL must be a public https:// endpoint",
      }),
    apiKey: z.string().min(1),
  })
  .refine(
    (config) =>
      !BUILT_IN_PROVIDER_PREFIXES.includes(
        config.name.toLowerCase() as (typeof BUILT_IN_PROVIDER_PREFIXES)[number],
      ),
    {
      path: ["name"],
      message: "This provider name is reserved for the built-in gateway",
    },
  );

export type CustomProviderConfig = z.infer<typeof customProviderSchema>;

export interface CustomProviderListItem {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  isEnabled: boolean;
  isUserOwned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomProviderModel {
  id: string;
  name: string;
  description?: string;
  providerPrefix: string;
}

function toListItem(
  provider: CustomProvider,
  userId: string,
): CustomProviderListItem {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    hasApiKey: provider.apiKey.length > 0,
    isEnabled: provider.isEnabled,
    isUserOwned: provider.userId === userId,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export async function getCustomProviders(
  userId: string,
): Promise<CustomProviderListItem[]> {
  const adminProviders = await db
    .select()
    .from(customProviders)
    .where(
      and(isNull(customProviders.userId), eq(customProviders.isEnabled, true)),
    );

  const userProviders = await db
    .select()
    .from(customProviders)
    .where(eq(customProviders.userId, userId));

  const allProviders = [...adminProviders, ...userProviders];
  return allProviders.map((p) => toListItem(p, userId));
}

/**
 * Returns all enabled custom provider records (with API keys) accessible by
 * the user: admin-wide providers + the user's own providers.
 */
export async function getCustomProvidersWithKeys(
  userId: string,
): Promise<CustomProvider[]> {
  const adminProviders = await db
    .select()
    .from(customProviders)
    .where(
      and(isNull(customProviders.userId), eq(customProviders.isEnabled, true)),
    );

  const userProviders = await db
    .select()
    .from(customProviders)
    .where(
      and(
        eq(customProviders.userId, userId),
        eq(customProviders.isEnabled, true),
      ),
    );

  return [...adminProviders, ...userProviders];
}

export async function getCustomProviderByKey(
  userId: string,
  providerId: string,
): Promise<CustomProvider | null> {
  // Only the owning user may update or delete a provider, admin-wide
  // providers (userId null) are managed out-of-band. The enabled filter is
  // intentionally absent so a disabled provider can still be re-enabled or
  // deleted instead of becoming a dead end.
  const [provider] = await db
    .select()
    .from(customProviders)
    .where(
      and(
        eq(customProviders.id, providerId),
        eq(customProviders.userId, userId),
      ),
    )
    .limit(1);

  return provider ?? null;
}

const CUSTOM_PROVIDER_MODELS_TTL_MS = 5 * 60 * 1000;

interface CustomProviderModelsCacheEntry {
  expiresAt: number;
  models: CustomProviderModel[];
}

const customProviderModelsCache = new Map<
  string,
  CustomProviderModelsCacheEntry
>();

function invalidateCustomProviderModelsCache(): void {
  customProviderModelsCache.clear();
}

export async function createCustomProvider(
  userId: string,
  config: CustomProviderConfig,
): Promise<CustomProviderListItem> {
  const [created] = await db
    .insert(customProviders)
    .values({
      id: nanoid(),
      userId,
      name: config.name,
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      apiKey: config.apiKey,
    })
    .returning();

  invalidateCustomProviderModelsCache();

  return toListItem(created, userId);
}

export async function updateCustomProvider(
  userId: string,
  providerId: string,
  updates: Partial<CustomProviderConfig & { isEnabled: boolean }>,
): Promise<CustomProviderListItem | null> {
  const existing = await getCustomProviderByKey(userId, providerId);
  if (!existing) return null;

  const [updated] = await db
    .update(customProviders)
    .set({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.baseUrl !== undefined && {
        baseUrl: updates.baseUrl.replace(/\/+$/, ""),
      }),
      ...(updates.apiKey !== undefined && { apiKey: updates.apiKey }),
      ...(updates.isEnabled !== undefined && { isEnabled: updates.isEnabled }),
      updatedAt: new Date(),
    })
    .where(eq(customProviders.id, providerId))
    .returning();

  invalidateCustomProviderModelsCache();

  return toListItem(updated, userId);
}

export async function deleteCustomProvider(
  userId: string,
  providerId: string,
): Promise<boolean> {
  const existing = await getCustomProviderByKey(userId, providerId);
  if (!existing) return false;

  const [deleted] = await db
    .delete(customProviders)
    .where(eq(customProviders.id, providerId))
    .returning();

  invalidateCustomProviderModelsCache();

  return Boolean(deleted);
}

export async function fetchCustomProviderModels(
  provider: CustomProvider,
): Promise<CustomProviderModel[]> {
  const cached = customProviderModelsCache.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }

  const models = await fetchCustomProviderModelsFromRemote(provider);

  customProviderModelsCache.set(provider.id, {
    expiresAt: Date.now() + CUSTOM_PROVIDER_MODELS_TTL_MS,
    models,
  });

  return models;
}

async function fetchCustomProviderModelsFromRemote(
  provider: CustomProvider,
): Promise<CustomProviderModel[]> {
  if (isBlockedCustomProviderBaseUrl(provider.baseUrl)) {
    return [];
  }

  try {
    const response = await fetch(`${provider.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return [];
    }

    const data: unknown = await response.json();

    // Handle OpenAI-compatible /models response format
    const modelsData = z
      .object({
        data: z.array(
          z
            .object({
              id: z.string(),
              name: z.string().optional(),
              description: z.string().optional(),
            })
            .passthrough(),
        ),
      })
      .safeParse(data);

    if (!modelsData.success) {
      return [];
    }

    return modelsData.data.data.map((model) => ({
      id: `${provider.name.toLowerCase()}/${model.id}`,
      name: model.name ?? model.id,
      description: model.description ?? undefined,
      providerPrefix: provider.name.toLowerCase(),
    }));
  } catch {
    return [];
  }
}
