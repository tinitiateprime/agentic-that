export const TELEGRAM_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

export async function uploadTelegramDeviceFile({
  file,
  accountId,
  requestJson,
  requestBinary,
  onProgress = () => undefined,
}) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1) throw new Error("Choose a non-empty file.");
  if (!accountId) throw new Error("Select the sending Telegram profile first.");
  const created = await requestJson("/v1/media/uploads", {
    method: "POST",
    body: {
      accountId,
      fileName: file.name || "telegram-media.bin",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    },
  });
  const id = created?.upload?.id;
  if (!id) throw new Error("The Telegram worker did not create a media upload.");
  try {
    for (let offset = 0; offset < file.size; offset += TELEGRAM_UPLOAD_CHUNK_BYTES) {
      const chunk = file.slice(offset, Math.min(file.size, offset + TELEGRAM_UPLOAD_CHUNK_BYTES));
      const response = await requestBinary(
        `/v1/media/uploads/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}`,
        {
          method: "PUT",
          body: chunk,
          headers: {
            "content-type": "application/octet-stream",
            "x-upload-offset": String(offset),
          },
        },
      );
      onProgress(response?.upload?.offset || Math.min(file.size, offset + chunk.size), file.size);
    }
    const completed = await requestJson(`/v1/media/uploads/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      body: { accountId },
    });
    return completed.upload;
  } catch (error) {
    await requestBinary(
      `/v1/media/uploads/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}`,
      { method: "DELETE" },
    ).catch(() => undefined);
    throw error;
  }
}
