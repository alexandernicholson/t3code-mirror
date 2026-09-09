import { createFileRoute } from "@tanstack/react-router";
import { AdvisorsSettings } from "../components/settings/AdvisorsSettings";
export const Route = createFileRoute("/settings/agents")({ component: AdvisorsSettings });
