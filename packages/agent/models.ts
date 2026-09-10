import {
  createGateway,
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type GatewayModelId,
  type JSONValue,
  type LanguageModel,
} from "ai";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";

function supportsAdaptiveAnthropicThinking(modelId: string): boolean {
  return modelId.includes("4.6") || modelId.includes("4.7");
}

// Models with adaptive thinking support use effort control.
// Older models use the legacy extended thinking API with a budget.
function getAnthropicSettings(modelId: string): AnthropicLanguageModelOptions {
  if (supportsAdaptiveAnthropicThinking(modelId)) {
    return {
      effort: "medium",
      thinking: { type: "adaptive" },
    } satisfies AnthropicLanguageModelOptions;
  }

  return {
    thinking: { type: "enabled", budgetTokens: 8000 },
  };
}

function isJsonObject(value: unknown): value is Record<string, JSONValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toProviderOptionsRecord(
  options: Record<string, unknown>,
): Record<string, JSONValue> {
  return options as Record<string, JSONValue>;
}

function mergeRecords(
  base: Record<string, JSONValue>,
  override: Record<string, JSONValue>,
): Record<string, JSONValue> {
  const merged: Record<string, JSONValue> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existingValue = merged[key];

    if (isJsonObject(existingValue) && isJsonObject(value)) {
      merged[key] = mergeRecords(existingValue, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

export type ProviderOptionsByProvider = Record<
  string,
  Record<string, JSONValue>
>;

export function mergeProviderOptions(
  defaults: ProviderOptionsByProvider,
  overrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  if (!overrides || Object.keys(overrides).length === 0) {
    return defaults;
  }

  const merged: ProviderOptionsByProvider = { ...defaults };

  for (const [provider, providerOverrides] of Object.entries(overrides)) {
    const providerDefaults = merged[provider];

    if (!providerDefaults) {
      merged[provider] = providerOverrides;
      continue;
    }

    merged[provider] = mergeRecords(providerDefaults, providerOverrides);
  }

  return merged;
}

export interface GatewayConfig {
  baseURL: string;
  apiKey: string;
}

export interface GatewayOptions {
  config?: GatewayConfig;
  providerOptionsOverrides?: ProviderOptionsByProvider;
  appName?: string;
  appUrl?: string;
}

export type { GatewayModelId, LanguageModel, JSONValue };

/**
 * Custom providers are OpenAI-compatible endpoints, so only the "openai"
 * provider option key is read by the AI SDK model. Variant overrides created
 * by users are keyed by the custom provider's prefix (e.g. "openrouter"), so
 * they are renamed here before reaching the model; otherwise they would be
 * silently dropped.
 */
export function remapCustomProviderOptions(
  options: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  const { openai, ...rest } = options;

  let remaining: Record<string, JSONValue> = openai ?? {};
  for (const value of Object.values(rest)) {
    remaining = mergeRecords(remaining, toProviderOptionsRecord(value));
  }

  if (Object.keys(remaining).length === 0) return {};
  return { openai: remaining };
}

export function shouldApplyOpenAIReasoningDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5");
}

function shouldApplyOpenAITextVerbosityDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5.4");
}

export function getProviderOptionsForModel(
  modelId: string,
  providerOptionsOverrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  const defaultProviderOptions: ProviderOptionsByProvider = {};

  // Apply anthropic defaults
  if (modelId.startsWith("anthropic/")) {
    defaultProviderOptions.anthropic = toProviderOptionsRecord(
      getAnthropicSettings(modelId),
    );
  }

  // OpenAI model responses should never be persisted.
  if (modelId.startsWith("openai/")) {
    defaultProviderOptions.openai = toProviderOptionsRecord({
      store: false,
    } satisfies OpenAIResponsesProviderOptions);
  }

  // Apply OpenAI defaults for all GPT-5 variants to expose encrypted reasoning content.
  // This avoids Responses API failures when `store: false`, e.g.:
  // "Item with id 'rs_...' not found. Items are not persisted when `store` is set to false."
  if (shouldApplyOpenAIReasoningDefaults(modelId)) {
    defaultProviderOptions.openai = mergeRecords(
      defaultProviderOptions.openai ?? {},
      toProviderOptionsRecord({
        reasoningSummary: "detailed",
        include: ["reasoning.encrypted_content"],
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  if (shouldApplyOpenAITextVerbosityDefaults(modelId)) {
    defaultProviderOptions.openai = mergeRecords(
      defaultProviderOptions.openai ?? {},
      toProviderOptionsRecord({
        textVerbosity: "low",
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  const providerOptions = mergeProviderOptions(
    defaultProviderOptions,
    providerOptionsOverrides,
  );

  // Enforce OpenAI non-persistence even when custom provider overrides are present.
  if (modelId.startsWith("openai/")) {
    providerOptions.openai = mergeRecords(
      providerOptions.openai ?? {},
      toProviderOptionsRecord({
        store: false,
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  return providerOptions;
}

export function gateway(
  modelId: GatewayModelId,
  options: GatewayOptions = {},
): LanguageModel {
  const { config, providerOptionsOverrides, appName, appUrl } = options;

  const attributionHeaders = {
    "http-referer": appUrl ?? "https://agents-oss.vercel.app",
    "x-title": appName ?? "Open Agents",
  };

  const baseGateway = config
    ? createGateway({
        baseURL: config.baseURL,
        apiKey: config.apiKey,
        headers: attributionHeaders,
      })
    : createGateway({ headers: attributionHeaders });

  // Custom providers are OpenAI-compatible endpoints. The first path segment
  // of the model id identifies the provider config (e.g. "openrouter"), so it
  // must be stripped before the model id is sent to the provider's API.
  const callModelId = config ? stripCustomProviderPrefix(modelId) : modelId;
  let model: LanguageModel = baseGateway(callModelId);

  // Provider-specific defaults (Anthropic thinking, OpenAI store:false, etc.)
  // only apply to the built-in AI Gateway, which speaks each provider's native
  // protocol. A custom baseURL is a generic OpenAI-compatible endpoint, so only
  // explicit overrides (e.g. user model variants) are applied.
  const providerOptions = config
    ? remapCustomProviderOptions(providerOptionsOverrides ?? {})
    : getProviderOptionsForModel(modelId, providerOptionsOverrides);

  if (Object.keys(providerOptions).length > 0) {
    model = wrapLanguageModel({
      model,
      middleware: defaultSettingsMiddleware({
        settings: { providerOptions },
      }),
    });
  }

  return model;
}

/**
 * Strip the leading custom-provider segment from a model id.
 * e.g. "openrouter/anthropic/claude-sonnet-4.5" -> "anthropic/claude-sonnet-4.5"
 * Models without a provider prefix are returned unchanged.
 */
export function stripCustomProviderPrefix(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) return modelId;
  return modelId.slice(slashIndex + 1);
}
