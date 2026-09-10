"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ProviderIcon } from "@/components/provider-icons";

interface CustomProviderItem {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  isEnabled: boolean;
  isUserOwned: boolean;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}

function AddProviderDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (config: {
    name: string;
    baseUrl: string;
    apiKey: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onAdd({ name, baseUrl, apiKey });
      setName("");
      setBaseUrl("");
      setApiKey("");
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Custom Provider</DialogTitle>
          <DialogDescription>
            Add an OpenAI-compatible API provider (OpenRouter, Kilo, OpenCode
            Zen, etc.)
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="provider-name">Name</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. OpenRouter"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-url">Base URL</Label>
            <Input
              id="provider-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="e.g. https://openrouter.ai/api/v1"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-key">API Key</Label>
            <Input
              id="provider-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              required
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isSaving}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Add Provider
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProviderCard({
  provider,
  onToggle,
  onDelete,
}: {
  provider: CustomProviderItem;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [isToggling, setIsToggling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleToggle(checked: boolean) {
    setIsToggling(true);
    try {
      await onToggle(provider.id, checked);
    } finally {
      setIsToggling(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await onDelete(provider.id);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <ProviderIcon
          provider={provider.name.toLowerCase()}
          className="size-5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{provider.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {provider.baseUrl}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!provider.isUserOwned && (
          <span className="text-xs text-muted-foreground">Admin</span>
        )}
        <Switch
          checked={provider.isEnabled}
          onCheckedChange={handleToggle}
          disabled={isToggling || !provider.isUserOwned}
        />
        {provider.isUserOwned && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function CustomProvidersSection() {
  const [providers, setProviders] = useState<CustomProviderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const fetchProviders = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/custom-providers");
      if (response.ok) {
        const data = await response.json();
        setProviders(data.providers ?? []);
      }
    } catch {
      console.error("Failed to fetch custom providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleAdd = useCallback(
    async (config: { name: string; baseUrl: string; apiKey: string }) => {
      const response = await fetch("/api/settings/custom-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Failed to add provider");
      }

      toast.success("Provider added");
      await fetchProviders();
    },
    [fetchProviders],
  );

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      const response = await fetch("/api/settings/custom-providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isEnabled: enabled }),
      });

      if (!response.ok) {
        throw new Error("Failed to update provider");
      }

      await fetchProviders();
    },
    [fetchProviders],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const response = await fetch("/api/settings/custom-providers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        toast.error("Failed to delete provider");
        return;
      }

      toast.success("Provider removed");
      await fetchProviders();
    },
    [fetchProviders],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader>Custom Providers</SectionHeader>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAddDialogOpen(true)}
        >
          <Plus className="mr-1 size-4" />
          Add Provider
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Connect OpenAI-compatible API providers like OpenRouter, Kilo, or
        OpenCode Zen. Models from these providers will appear in the model
        selector.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : providers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No custom providers configured.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a provider to access its models in the chat.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <AddProviderDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={handleAdd}
      />
    </div>
  );
}
