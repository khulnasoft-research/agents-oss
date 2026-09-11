import type { AgentModelSelection, GatewayConfig } from "@agents-oss/agent";
import { resolveAvailableModelId } from "@/lib/model-availability";
import { type ModelVariant, resolveModelSelection } from "@/lib/model-variants";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

interface ResolveChatModelSelectionParams {
  selectedModelId: string | null | undefined;
  modelVariants: ModelVariant[];
  missingVariantLabel: string;
  customProviders?: CustomProviderConfig[];
}

function resolveCustomProviderConfig(
  modelId: string,
  customProviders: CustomProviderConfig[],
): GatewayConfig | undefined {
  // Model ID format: "<provider-name>/<model-id>"
  // The first segment is the provider name we match against
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) return undefined;

  const providerPrefix = modelId.slice(0, slashIndex).toLowerCase();
  const provider = customProviders.find(
    (p) => p.name.toLowerCase() === providerPrefix,
  );

  if (!provider) return undefined;

  return {
    baseURL: provider.baseUrl,
    apiKey: provider.apiKey,
  };
}

export function resolveChatModelSelection({
  selectedModelId,
  modelVariants,
  missingVariantLabel,
  customProviders,
}: ResolveChatModelSelectionParams): AgentModelSelection {
  const requestedModelId = selectedModelId ?? APP_DEFAULT_MODEL_ID;
  const selection = resolveModelSelection(requestedModelId, modelVariants);

  if (selection.isMissingVariant) {
    console.warn(
      `${missingVariantLabel} "${requestedModelId}" was not found. Falling back to default model.`,
    );
    return { id: APP_DEFAULT_MODEL_ID as AgentModelSelection["id"] };
  }

  const availableModelId = resolveAvailableModelId(selection.resolvedModelId);
  if (availableModelId !== selection.resolvedModelId) {
    console.warn(
      `${missingVariantLabel} "${requestedModelId}" resolves to disabled model "${selection.resolvedModelId}". Falling back to default model.`,
    );
    return { id: APP_DEFAULT_MODEL_ID as AgentModelSelection["id"] };
  }

  const gatewayConfig = customProviders?.length
    ? resolveCustomProviderConfig(availableModelId, customProviders)
    : undefined;

  return {
    id: availableModelId as AgentModelSelection["id"],
    ...(selection.providerOptionsByProvider
      ? {
          providerOptionsOverrides: selection.providerOptionsByProvider,
        }
      : {}),
    ...(gatewayConfig ? { gatewayConfig } : {}),
  };
}
