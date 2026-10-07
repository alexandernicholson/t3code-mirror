import { createRef, type ComponentRef } from "react";
import { View } from "react-native";

// Android BlurViews sample the application content bound in App.tsx.
export const appBlurTargetRef = createRef<ComponentRef<typeof View>>();
