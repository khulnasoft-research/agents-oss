export type OpenAgentsResourceProfile = "standard" | "hobby";

export function getOpenAgentsResourceProfile(): OpenAgentsResourceProfile {
  const configuredProfile =
    process.env.OPEN_AGENTS_RESOURCE_PROFILE ??
    process.env.AGENTS_OSS_RESOURCE_PROFILE;

  return configuredProfile === "hobby" ? "hobby" : "standard";
}

export function isHobbyResourceProfile(): boolean {
  return getOpenAgentsResourceProfile() === "hobby";
}
