import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "./db/client";
import { customProviders, type CustomProvider } from "./db/schema";

export type { CustomProvider } from "./db/schema";

export const customProviderSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
});

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
  const [provider] = await db
    .select()
    .from(customProviders)
    .where(
      and(
        eq(customProviders.id, providerId),
        eq(customProviders.isEnabled, true),
      ),
    )
    .limit(1);

  if (!provider) return null;

  // User-owned or admin-wide provider
  if (provider.userId === userId || provider.userId === null) {
    return provider;
  }

  return null;
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

  return toListItem(updated, userId);
}

export async function deleteCustomProvider(
  userId: string,
  providerId: string,
): Promise<boolean> {
  const existing = await getCustomProviderByKey(userId, providerId);
  if (!existing) return false;
  if (existing.userId === null) return false; // Cannot delete admin-wide providers

  const [deleted] = await db
    .delete(customProviders)
    .where(eq(customProviders.id, providerId))
    .returning();

  return Boolean(deleted);
}

export async function fetchCustomProviderModels(
  provider: CustomProvider,
): Promise<CustomProviderModel[]> {
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
