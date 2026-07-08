export const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_IMAGE_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateImageFiles(files, existingCount = 0) {
  const fileList = Array.from(files ?? []);
  const errors = [];
  if (existingCount + fileList.length > MAX_IMAGE_ATTACHMENTS) {
    errors.push(`Attach up to ${MAX_IMAGE_ATTACHMENTS} images.`);
  }
  for (const file of fileList) {
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      errors.push(`${file.name || "Image"} must be PNG, JPEG, or WebP.`);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(`${file.name || "Image"} must be 5 MB or smaller.`);
    }
  }
  return errors;
}

export function imageFilesFromClipboardData(clipboardData) {
  if (!clipboardData) return [];
  const itemFiles = Array.from(clipboardData.items ?? [])
    .filter((item) => item?.kind === "file" && IMAGE_MIME_TYPES.has(item.type))
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  if (itemFiles.length > 0) return itemFiles;
  return Array.from(clipboardData.files ?? []).filter((file) => IMAGE_MIME_TYPES.has(file.type));
}

export async function attachmentsFromImageFiles(files) {
  const attachments = [];
  for (const file of Array.from(files ?? [])) {
    attachments.push({
      kind: "image",
      name: file.name || "Pasted image",
      data: await readFileAsBase64(file),
      mimeType: file.type,
    });
  }
  return attachments;
}

export function attachmentLabel(attachment) {
  if (!attachment) return "Attachment";
  if (attachment.kind === "image") return attachment.name || "Image";
  if (attachment.kind === "portfolio") return attachment.label || "Portfolio";
  if (attachment.kind === "watchlist") return attachment.label || "Watchlist";
  if (attachment.kind === "report") return attachment.label || "Latest report";
  return attachment.label || "Attachment";
}

export function attachmentsForRequest(attachments) {
  const images = [];
  const saved = [];
  for (const attachment of attachments ?? []) {
    if (attachment.kind === "image") {
      images.push({ data: attachment.data, mimeType: attachment.mimeType });
    } else {
      saved.push({ kind: attachment.kind, ...(attachment.id ? { id: attachment.id } : {}) });
    }
  }
  return {
    ...(images.length > 0 ? { images } : {}),
    ...(saved.length > 0 ? { attachments: saved } : {}),
  };
}

export function attachmentsForOptimisticMessage(attachments) {
  return Array.from(attachments ?? [])
    .map((attachment) => ({
      kind: String(attachment?.kind || ""),
      label: attachmentLabel(attachment),
    }))
    .filter((attachment) => attachment.kind);
}

async function readFileAsBase64(file) {
  if (typeof file.arrayBuffer === "function") {
    const buffer = await file.arrayBuffer();
    return bytesToBase64(new Uint8Array(buffer));
  }
  return readFileAsDataUrl(file).then((dataUrl) => dataUrl.split(",")[1] ?? "");
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image."));
    reader.readAsDataURL(file);
  });
}
