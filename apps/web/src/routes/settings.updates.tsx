import { createFileRoute } from "@tanstack/react-router";
import { SourceUpdatesSettings } from "../components/SourceUpdates";

export const Route = createFileRoute("/settings/updates")({ component: SourceUpdatesSettings });
