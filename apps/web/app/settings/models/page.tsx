import type { Metadata } from "next";
import { ModelVariantsSection } from "../model-variants-section";
import { ModelPreferencesSection } from "../preferences-section";
import { CustomProvidersSection } from "../custom-providers-section";

export const metadata: Metadata = {
  title: "Models",
  description:
    "Configure model preferences, custom providers, and model variants.",
};

export default function ModelsPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Models</h1>
        <p className="text-sm text-muted-foreground">
          Set your default models, connect custom providers, and create named
          variants with provider-specific settings.
        </p>
      </div>

      <ModelPreferencesSection />

      <div className="border-t border-border/50" />

      <CustomProvidersSection />

      <div className="border-t border-border/50" />

      <ModelVariantsSection />
    </div>
  );
}
