import { createFileRoute } from "@tanstack/react-router";
import { ToolsSettings } from "../components/settings/ToolsSettings";
export const Route = createFileRoute("/settings/tools")({
  component: ToolsSettings,
  validateSearch: (search): { environment?: string } =>
    typeof search.environment === "string" ? { environment: search.environment } : {},
});
