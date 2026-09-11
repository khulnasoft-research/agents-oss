import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CustomProvider } from "./custom-providers";

interface MockDbConfig {
  selectRows: CustomProvider[];
  writeResult: CustomProvider[];
}

const mockDbConfig: MockDbConfig = {
  selectRows: [],
  writeResult: [],
};

function isColumnChunk(chunk: unknown): chunk is { name: string } {
  return (
    typeof chunk === "object" &&
    chunk !== null &&
    typeof (chunk as { name?: unknown }).name === "string" &&
    (chunk as { table?: unknown }).table !== undefined
  );
}

function toRowKey(columnName: string): keyof CustomProvider {
  return columnName.replace(/_([a-z])/g, (_match, char: string) =>
    char.toUpperCase(),
  ) as keyof CustomProvider;
}

/**
 * Extract the `column = value` pairs from a drizzle where clause so the mock
 * can behave like a real database for the authz predicates under test.
 */
function extractWherePredicate(where: unknown): Record<string, unknown> {
  const predicate: Record<string, unknown> = {};

  const visitChunks = (node: unknown): void => {
    if (typeof node !== "object" || node === null) {
      return;
    }

    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) {
      return;
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (isColumnChunk(chunk)) {
        // The bound value follows the column in a later chunk, separated by
        // operator chunks (e.g. ['"col"', ' = ', Param]).
        for (let j = i + 1; j < Math.min(i + 4, chunks.length); j++) {
          const next = chunks[j];
          if (
            typeof next === "object" &&
            next !== null &&
            (next as { constructor?: { name?: string } }).constructor?.name ===
              "Param" &&
            "value" in (next as object)
          ) {
            predicate[toRowKey(chunk.name)] = (
              next as { value: unknown }
            ).value;
            break;
          }
        }
      } else {
        visitChunks(chunk);
      }
    }
  };

  visitChunks(where);
  return predicate;
}

function createMockDb(config: MockDbConfig) {
  return {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          const predicate = extractWherePredicate(condition);
          const filtered = config.selectRows.filter((row) =>
            Object.entries(predicate).every(
              ([column, value]) =>
                (row as Record<string, unknown>)[column] === value,
            ),
          );
          const filteredPromise = Promise.resolve(filtered) as Promise<
            CustomProvider[]
          > & { limit: (count: number) => Promise<CustomProvider[]> };
          filteredPromise.limit = async () => filtered;
          return filteredPromise;
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => config.writeResult,
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => config.writeResult,
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => config.writeResult,
      }),
    }),
  };
}

mock.module("@/lib/db/client", () => ({
  db: createMockDb(mockDbConfig),
}));

const fetchMock = mock<
  (input: string | URL | Request, init?: RequestInit) => Promise<Response>
>(async () => {
  return new Response(
    JSON.stringify({
      data: [{ id: "anthropic/claude-sonnet-4.5" }],
    }),
    { status: 200 },
  );
});

globalThis.fetch = fetchMock as unknown as typeof fetch;

const {
  customProviderSchema,
  deleteCustomProvider,
  fetchCustomProviderModels,
  getCustomProviderByKey,
  updateCustomProvider,
} = await import("./custom-providers");

const provider: CustomProvider = {
  id: "provider-1",
  userId: "user-1",
  name: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "sk-test",
  isEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(() => {
  fetchMock.mockClear();
});

describe("fetchCustomProviderModels", () => {
  test("returns prefixed models from the OpenAI-compatible /models endpoint", async () => {
    const models = await fetchCustomProviderModels(provider);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      {
        headers: { Authorization: "Bearer sk-test" },
        signal: expect.anything(),
      },
    );
    expect(models).toEqual([
      {
        id: "openrouter/anthropic/claude-sonnet-4.5",
        name: "anthropic/claude-sonnet-4.5",
        providerPrefix: "openrouter",
      },
    ]);
  });

  test("caches results per provider within the TTL window", async () => {
    const cachedProvider: CustomProvider = { ...provider, id: "provider-2" };

    const first = await fetchCustomProviderModels(cachedProvider);
    const second = await fetchCustomProviderModels(cachedProvider);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  test("returns an empty list on non-OK responses", async () => {
    const unauthorizedProvider: CustomProvider = {
      ...provider,
      id: "provider-unauthorized",
    };

    fetchMock.mockImplementationOnce(
      async () => new Response("nope", { status: 401 }),
    );

    expect(await fetchCustomProviderModels(unauthorizedProvider)).toEqual([]);
  });

  test("does not fetch from blocked base URLs", async () => {
    const blockedProvider: CustomProvider = {
      ...provider,
      id: "provider-blocked",
      baseUrl: "https://localhost:8443/api/v1",
    };

    expect(await fetchCustomProviderModels(blockedProvider)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("customProviderSchema validation", () => {
  const validConfig = {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "sk-test",
  };

  test("accepts a public https endpoint", () => {
    expect(customProviderSchema.safeParse(validConfig).success).toBe(true);
  });

  test("rejects http base URLs", () => {
    const result = customProviderSchema.safeParse({
      ...validConfig,
      baseUrl: "http://openrouter.ai/api/v1",
    });

    expect(result.success).toBe(false);
  });

  test("rejects loopback, private, and literal internal hosts", () => {
    for (const baseUrl of [
      "https://localhost:8443/api/v1",
      "https://127.0.0.1/api/v1",
      "https://10.0.0.1/api/v1",
      "https://172.16.0.1/api/v1",
      "https://192.168.1.10/api/v1",
      "https://169.254.169.254/metadata",
      "https://[::1]/api/v1",
      "https://api.internal",
      "https://svc.local",
    ]) {
      const result = customProviderSchema.safeParse({
        ...validConfig,
        baseUrl,
      });

      expect(result.success).toBe(false);
    }
  });

  test("rejects names containing slashes or other unsafe characters", () => {
    for (const name of ["open/router", "my provider/hack", "name@x", "a/b"]) {
      const result = customProviderSchema.safeParse({ ...validConfig, name });

      expect(result.success).toBe(false);
    }
  });

  test("rejects names that shadow a built-in gateway provider", () => {
    for (const name of ["openai", "OPENAI", "anthropic", "Google"]) {
      const result = customProviderSchema.safeParse({ ...validConfig, name });

      expect(result.success).toBe(false);
    }
  });

  test("trims provider names", () => {
    const result = customProviderSchema.safeParse({
      ...validConfig,
      name: "  OpenRouter  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("OpenRouter");
    }
  });
});

describe("custom provider ownership guards", () => {
  beforeEach(() => {
    mockDbConfig.selectRows = [];
    mockDbConfig.writeResult = [];
  });

  test("getCustomProviderByKey returns the provider for the owning user", async () => {
    mockDbConfig.selectRows = [provider];

    await expect(
      getCustomProviderByKey("user-1", "provider-1"),
    ).resolves.toEqual(provider);
  });

  test("getCustomProviderByKey returns null for another user's provider", async () => {
    mockDbConfig.selectRows = [{ ...provider, userId: "user-2" }];

    await expect(
      getCustomProviderByKey("user-1", "provider-1"),
    ).resolves.toBeNull();
  });

  test("getCustomProviderByKey returns null for admin-wide providers", async () => {
    mockDbConfig.selectRows = [{ ...provider, userId: null }];

    await expect(
      getCustomProviderByKey("user-1", "provider-1"),
    ).resolves.toBeNull();
  });

  test("getCustomProviderByKey returns a disabled provider so it can be re-enabled", async () => {
    mockDbConfig.selectRows = [{ ...provider, isEnabled: false }];

    await expect(
      getCustomProviderByKey("user-1", "provider-1"),
    ).resolves.toMatchObject({ isEnabled: false });
  });

  test("updateCustomProvider rejects admin-wide providers", async () => {
    mockDbConfig.selectRows = [{ ...provider, userId: null }];

    await expect(
      updateCustomProvider("user-1", "provider-1", { name: "Hacked" }),
    ).resolves.toBeNull();
  });

  test("updateCustomProvider rejects another user's provider", async () => {
    mockDbConfig.selectRows = [{ ...provider, userId: "user-2" }];

    await expect(
      updateCustomProvider("user-1", "provider-1", { name: "Hacked" }),
    ).resolves.toBeNull();
  });

  test("updateCustomProvider re-enables a disabled user-owned provider", async () => {
    const disabled = { ...provider, isEnabled: false };
    mockDbConfig.selectRows = [disabled];
    mockDbConfig.writeResult = [{ ...disabled, isEnabled: true }];

    const updated = await updateCustomProvider("user-1", "provider-1", {
      isEnabled: true,
    });

    expect(updated?.isEnabled).toBe(true);
  });

  test("deleteCustomProvider removes a disabled user-owned provider", async () => {
    mockDbConfig.selectRows = [{ ...provider, isEnabled: false }];
    mockDbConfig.writeResult = [provider];

    await expect(deleteCustomProvider("user-1", "provider-1")).resolves.toBe(
      true,
    );
  });

  test("deleteCustomProvider rejects admin-wide providers", async () => {
    mockDbConfig.selectRows = [{ ...provider, userId: null }];

    await expect(deleteCustomProvider("user-1", "provider-1")).resolves.toBe(
      false,
    );
  });
});
