import { filterModelsForSession } from "@/lib/model-access";
import {
  fetchCustomProviderModels,
  getCustomProviders,
  type CustomProvider,
} from "@/lib/custom-providers";
import { getEnvCustomProviders } from "@/lib/custom-providers-env";
import { fetchAvailableLanguageModelsWithContext } from "@/lib/models-with-context";
import type { AvailableModel } from "@/lib/models";
import { getServerSession } from "@/lib/session/get-server-session";
import { db } from "@/lib/db/client";
import { customProviders } from "@/lib/db/schema";
import { eq, isNull } from "drizzle-orm";

const CACHE_CONTROL = "private, no-store";

async function fetchAllCustomProviderModels(
  userId: string,
): Promise<AvailableModel[]> {
  const [dbProviders, envProviders] = await Promise.all([
    getCustomProviders(userId),
    Promise.resolve(getEnvCustomProviders()),
  ]);

  // Merge: env providers are admin-wide, DB providers include user-owned
  const allProviders: CustomProvider[] = [];

  // Load full DB provider records (with API keys) for model fetching
  if (dbProviders.length > 0) {
    const dbRecords = await db
      .select()
      .from(customProviders)
      .where(eq(customProviders.isEnabled, true));

    for (const record of dbRecords) {
      // Include if admin-wide or owned by this user
      if (record.userId === null || record.userId === userId) {
        allProviders.push(record);
      }
    }
  }

  // Add env providers
  for (const env of envProviders) {
    allProviders.push({
      id: `env:${env.name}`,
      userId: null,
      name: env.name,
      baseUrl: env.baseUrl,
      apiKey: env.apiKey,
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Fetch models from all providers in parallel
  const modelArrays = await Promise.all(
    allProviders.map((provider) => fetchCustomProviderModels(provider)),
  );

  return modelArrays.flat().map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    modelType: "language" as const,
  }));
}

export async function GET(req: Request) {
  try {
    const [session, gatewayModels] = await Promise.all([
      getServerSession(),
      fetchAvailableLanguageModelsWithContext(),
    ]);

    const userId = session?.user?.id;
    const customModels = userId
      ? await fetchAllCustomProviderModels(userId).catch(() => [])
      : [];

    const allModels = [...gatewayModels, ...customModels];

    return Response.json(
      { models: filterModelsForSession(allModels, session, req.url) },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL,
        },
      },
    );
  } catch (error) {
    console.error("Failed to fetch available models:", error);
    return Response.json(
      { error: "Failed to fetch available models" },
      { status: 500 },
    );
  }
}
