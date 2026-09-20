import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { runAttachmentUploadCycle } from "@t3tools/client-runtime/state/attachments";
import {
  CUSTOM_BACKGROUND_MAX_UPLOAD_BYTES,
  customConversationBackgroundAttachmentId,
  type CustomProjectConversationBackground,
  type EnvironmentId,
  type ProjectConversationBackground,
} from "@t3tools/contracts";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { attachmentEnvironment } from "../state/attachments";
import { readPreparedConnection } from "../state/session";
import { prepareImageForBackground } from "./imageCompression";
import { deletePendingAttachmentUpload } from "@t3tools/client-runtime/state/attachments";

function uploadBytes(url: string, file: File) {
  const controller = new AbortController();
  const done = fetch(url, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Upload rejected (${response.status})`);
    }
  });
  return { done, abort: () => controller.abort() };
}

function supportedMimeType(file: File): "image/gif" | "image/jpeg" | "image/png" | "image/webp" {
  if (
    file.type === "image/gif" ||
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.type === "image/webp"
  ) {
    return file.type;
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function prepareConversationBackgroundUpload(source: File): Promise<File> {
  const prepared = await prepareImageForBackground(source, CUSTOM_BACKGROUND_MAX_UPLOAD_BYTES);
  if (!prepared.ok) {
    throw new Error(
      prepared.reason === "too-large"
        ? "That image is too large to use safely. Try a shorter animation or a smaller file."
        : "That image could not be read.",
    );
  }
  const preparedFile = prepared.file;
  const mimeType = supportedMimeType(preparedFile);
  return preparedFile.type === mimeType
    ? preparedFile
    : new File([preparedFile], preparedFile.name, {
        type: mimeType,
        lastModified: preparedFile.lastModified,
      });
}

export async function uploadPreparedConversationBackground(
  environmentId: EnvironmentId,
  source: File,
): Promise<CustomProjectConversationBackground> {
  const file = source;
  const mimeType = supportedMimeType(file);
  const result = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId,
    upload: {
      type: "background",
      name: file.name,
      mimeType,
      sizeBytes: file.size,
    },
    resolveUploadUrl: (relativeUrl) => {
      const connection = readPreparedConnection(environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    transport: (url) => uploadBytes(url, file),
  });
  if (result.status !== "uploaded") {
    throw result.status === "failed" && result.error instanceof Error
      ? result.error
      : new Error("Background upload was cancelled.");
  }
  return `custom:${result.attachmentId}` as CustomProjectConversationBackground;
}

export function deleteConversationBackgroundAsset(
  environmentId: EnvironmentId,
  background: ProjectConversationBackground | null | undefined,
): void {
  const attachmentId = customConversationBackgroundAttachmentId(background);
  if (!attachmentId) return;
  deletePendingAttachmentUpload({
    registry: appAtomRegistry,
    remove: attachmentEnvironment.remove,
    environmentId,
    attachmentId,
  });
}
