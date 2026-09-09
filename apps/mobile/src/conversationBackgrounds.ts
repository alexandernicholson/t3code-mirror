import type { ProjectConversationBackground } from "@t3tools/contracts";

const BACKGROUND_SOURCE_BY_ID: Record<ProjectConversationBackground, number> = {
  "workstation-mountain-cabin": require("../assets/conversation-backgrounds/workstation-mountain-cabin.jpg"),
  "workstation-brutalist-studio": require("../assets/conversation-backgrounds/workstation-brutalist-studio.jpg"),
  "workstation-rainy-loft": require("../assets/conversation-backgrounds/workstation-rainy-loft.jpg"),
  "workstation-moonlit-observatory": require("../assets/conversation-backgrounds/workstation-moonlit-observatory.jpg"),
  "workstation-stormy-ocean": require("../assets/conversation-backgrounds/workstation-stormy-ocean.jpg"),
  "landscape-alpine-lake": require("../assets/conversation-backgrounds/landscape-alpine-lake.jpg"),
  "landscape-northern-cliffs": require("../assets/conversation-backgrounds/landscape-northern-cliffs.jpg"),
  "landscape-redwoods": require("../assets/conversation-backgrounds/landscape-redwoods.jpg"),
  "landscape-twilight-dunes": require("../assets/conversation-backgrounds/landscape-twilight-dunes.jpg"),
  "landscape-glacial-valley": require("../assets/conversation-backgrounds/landscape-glacial-valley.jpg"),
  "abstract-folded-graphite": require("../assets/conversation-backgrounds/abstract-folded-graphite.jpg"),
  "abstract-midnight-ribbon": require("../assets/conversation-backgrounds/abstract-midnight-ribbon.jpg"),
  "abstract-moss-contours": require("../assets/conversation-backgrounds/abstract-moss-contours.jpg"),
  "abstract-frosted-plum": require("../assets/conversation-backgrounds/abstract-frosted-plum.jpg"),
  "abstract-monumental-graphite": require("../assets/conversation-backgrounds/abstract-monumental-graphite.jpg"),
};

export function getMobileConversationBackgroundSource(
  id: ProjectConversationBackground | null | undefined,
): number | null {
  return id ? BACKGROUND_SOURCE_BY_ID[id] : null;
}
