import { createReviewerAtoms } from "@t3tools/client-runtime/state/reviewers";
import { connectionAtomRuntime } from "../connection/runtime";

export const reviewers = createReviewerAtoms(connectionAtomRuntime);
