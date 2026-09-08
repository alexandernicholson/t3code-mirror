import { createFileRoute } from "@tanstack/react-router";
import { SecretsSettings } from "../components/settings/SecretsSettings";
export const Route = createFileRoute("/settings/secrets")({ component: SecretsSettings });
