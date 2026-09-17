import { createRef } from "react";
import type { View } from "react-native";

// Android BlurViews need an explicit target to sample. App.tsx binds this
// shared ref so overlays and conversation backgrounds can blur app content.
export const appBlurTargetRef = createRef<View>();
