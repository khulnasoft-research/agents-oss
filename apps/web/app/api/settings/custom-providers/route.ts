import { z } from "zod";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  createCustomProvider,
  customProviderSchema,
  deleteCustomProvider,
  getCustomProviders,
  updateCustomProvider,
} from "@/lib/custom-providers";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const providers = await getCustomProviders(session.user.id);
  return Response.json({ providers });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = customProviderSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid provider config", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const provider = await createCustomProvider(session.user.id, parsed.data);
    return Response.json({ provider }, { status: 201 });
  } catch (error) {
    console.error("Failed to create custom provider:", error);
    return Response.json(
      { error: "Failed to create provider" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updateSchema = customProviderSchema
    .partial()
    .extend({ id: z.string().min(1), isEnabled: z.boolean().optional() });
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid update payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { id, ...updates } = parsed.data;
  const provider = await updateCustomProvider(session.user.id, id, updates);
  if (!provider) {
    return Response.json(
      { error: "Provider not found or unauthorized" },
      { status: 404 },
    );
  }

  return Response.json({ provider });
}

export async function DELETE(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const deleteSchema = z.object({ id: z.string().min(1) });
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Missing provider id" }, { status: 400 });
  }

  const deleted = await deleteCustomProvider(session.user.id, parsed.data.id);
  if (!deleted) {
    return Response.json(
      { error: "Provider not found or cannot be deleted" },
      { status: 404 },
    );
  }

  return Response.json({ success: true });
}
