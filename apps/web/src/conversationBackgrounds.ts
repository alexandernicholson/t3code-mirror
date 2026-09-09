import type { ProjectConversationBackground } from "@t3tools/contracts";

import abstractFoldedGraphite from "./assets/conversation-backgrounds/abstract-folded-graphite.jpg";
import abstractFrostedPlum from "./assets/conversation-backgrounds/abstract-frosted-plum.jpg";
import abstractMidnightRibbon from "./assets/conversation-backgrounds/abstract-midnight-ribbon.jpg";
import abstractMonumentalGraphite from "./assets/conversation-backgrounds/abstract-monumental-graphite.jpg";
import abstractMossContours from "./assets/conversation-backgrounds/abstract-moss-contours.jpg";
import landscapeAlpineLake from "./assets/conversation-backgrounds/landscape-alpine-lake.jpg";
import landscapeGlacialValley from "./assets/conversation-backgrounds/landscape-glacial-valley.jpg";
import landscapeNorthernCliffs from "./assets/conversation-backgrounds/landscape-northern-cliffs.jpg";
import landscapeRedwoods from "./assets/conversation-backgrounds/landscape-redwoods.jpg";
import landscapeTwilightDunes from "./assets/conversation-backgrounds/landscape-twilight-dunes.jpg";
import workstationBrutalistStudio from "./assets/conversation-backgrounds/workstation-brutalist-studio.jpg";
import workstationMoonlitObservatory from "./assets/conversation-backgrounds/workstation-moonlit-observatory.jpg";
import workstationMountainCabin from "./assets/conversation-backgrounds/workstation-mountain-cabin.jpg";
import workstationRainyLoft from "./assets/conversation-backgrounds/workstation-rainy-loft.jpg";
import workstationStormyOcean from "./assets/conversation-backgrounds/workstation-stormy-ocean.jpg";

export interface ConversationBackgroundOption {
  readonly id: ProjectConversationBackground;
  readonly label: string;
  readonly src: string;
}

export interface ConversationBackgroundCollection {
  readonly id: "workstations" | "landscapes" | "abstract";
  readonly label: string;
  readonly options: ReadonlyArray<ConversationBackgroundOption>;
}

export const CONVERSATION_BACKGROUND_COLLECTIONS = [
  {
    id: "workstations",
    label: "Workstations",
    options: [
      { id: "workstation-mountain-cabin", label: "Mountain cabin", src: workstationMountainCabin },
      {
        id: "workstation-brutalist-studio",
        label: "Brutalist studio",
        src: workstationBrutalistStudio,
      },
      { id: "workstation-rainy-loft", label: "Rainy loft", src: workstationRainyLoft },
      {
        id: "workstation-moonlit-observatory",
        label: "Moonlit observatory",
        src: workstationMoonlitObservatory,
      },
      { id: "workstation-stormy-ocean", label: "Stormy ocean", src: workstationStormyOcean },
    ],
  },
  {
    id: "landscapes",
    label: "Landscapes",
    options: [
      { id: "landscape-alpine-lake", label: "Alpine lake", src: landscapeAlpineLake },
      {
        id: "landscape-northern-cliffs",
        label: "Northern cliffs",
        src: landscapeNorthernCliffs,
      },
      { id: "landscape-redwoods", label: "Redwood forest", src: landscapeRedwoods },
      { id: "landscape-twilight-dunes", label: "Twilight dunes", src: landscapeTwilightDunes },
      {
        id: "landscape-glacial-valley",
        label: "Glacial valley",
        src: landscapeGlacialValley,
      },
    ],
  },
  {
    id: "abstract",
    label: "Abstract",
    options: [
      {
        id: "abstract-folded-graphite",
        label: "Folded graphite",
        src: abstractFoldedGraphite,
      },
      { id: "abstract-midnight-ribbon", label: "Midnight ribbon", src: abstractMidnightRibbon },
      { id: "abstract-moss-contours", label: "Moss contours", src: abstractMossContours },
      { id: "abstract-frosted-plum", label: "Frosted plum", src: abstractFrostedPlum },
      {
        id: "abstract-monumental-graphite",
        label: "Monumental graphite",
        src: abstractMonumentalGraphite,
      },
    ],
  },
] as const satisfies ReadonlyArray<ConversationBackgroundCollection>;

const optionById = new Map(
  CONVERSATION_BACKGROUND_COLLECTIONS.flatMap((collection) =>
    collection.options.map((option) => [option.id, option] as const),
  ),
);

export function getConversationBackground(
  id: ProjectConversationBackground | null | undefined,
): ConversationBackgroundOption | null {
  return id ? (optionById.get(id) ?? null) : null;
}
