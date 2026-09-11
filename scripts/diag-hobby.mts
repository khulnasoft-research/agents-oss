import { createVercelSnapshotTemplateName, ensureVercelSnapshotTemplate } from "@agents-oss/sandbox/vercel";

const result = await ensureVercelSnapshotTemplate({
  templateName: createVercelSnapshotTemplateName(`dbg-hobby-${Date.now()}`),
  sandboxTimeoutMs: 2_370_000,
  ports: [3000, 5173, 4321, 8000, 5001, 5002, 5003, 5004, 5005],
  prepare: async () => {},
});
console.log("OK", JSON.stringify(result));
