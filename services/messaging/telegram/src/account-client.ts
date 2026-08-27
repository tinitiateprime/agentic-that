import bigInt from "big-integer";
import { lookup as dnsLookup } from "node:dns/promises";
import { open, mkdtemp, rm } from "node:fs/promises";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { Api, TelegramClient } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { StringSession } from "telegram/sessions/index.js";
import { CustomFile } from "telegram/client/uploads.js";

export type TelegramApiCredentials = {
  apiId: number;
  apiHash: string;
};

export type TelegramProfile = {
  telegramUserId: string;
  displayName: string;
  username: string;
};

export type LoginStartResult = {
  sessionString: string;
  phoneCodeHash: string;
  codeDelivery: "telegram_app" | "sms";
};

export type LoginCodeResult =
  | { kind: "authorized"; sessionString: string; profile: TelegramProfile }
  | { kind: "password_required"; sessionString: string };

export type SendMessageInput = {
  recipient: string;
  message: string;
  mediaUrl?: string;
  mediaFile?: {
    name: string;
    path: string;
    size: number;
  };
  mediaType?: string;
  firstName?: string;
  lastName?: string;
};

export type SentMessage = {
  recipient: string;
  messageId: string;
  sentAt: string;
};

export type IncomingTelegramMessage = {
  chatId: string;
  chatRef: string;
  senderId: string;
  senderRef: string;
  isPrivate: boolean;
  messageId: string;
  text: string;
  createdAt: string;
};

export type SyncedTelegramMessage = {
  direction: "inbound" | "outbound";
  recipient: string;
  messageId: string;
  text: string;
  createdAt: string;
};

export function normalizePhone(phone: string) {
  const normalized = phone.replace(/[^\d+]/g, "");
  if (!normalized.startsWith("+") || normalized.length < 8) {
    throw new Error("Phone number must include country code, for example +919876543210.");
  }
  return normalized;
}

export function telegramPhoneMatchesUser(phoneInput: string, telegramUserPhone = "") {
  if (!telegramUserPhone.trim()) return false;
  try {
    return normalizePhone(phoneInput).slice(1) === telegramUserPhone.replace(/\D/g, "");
  } catch {
    return false;
  }
}

function createClient(credentials: TelegramApiCredentials, sessionString = "") {
  return new TelegramClient(new StringSession(sessionString), credentials.apiId, credentials.apiHash, {
    connectionRetries: 5
  });
}

function saveSession(client: TelegramClient) {
  return client.session.save() as unknown as string;
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "errorMessage" in error) {
    return String((error as { errorMessage: unknown }).errorMessage);
  }
  return error instanceof Error ? error.message : String(error);
}

function profileFromUser(user: Api.User): TelegramProfile {
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return {
    telegramUserId: user.id.toString(),
    displayName: displayName || user.username || "Telegram account",
    username: user.username ?? ""
  };
}

export async function beginTelegramLogin(credentials: TelegramApiCredentials, phoneInput: string): Promise<LoginStartResult> {
  const phone = normalizePhone(phoneInput);
  const client = createClient(credentials);

  try {
    await client.connect();
    const result = await client.sendCode(
      { apiId: credentials.apiId, apiHash: credentials.apiHash },
      phone
    );
    return {
      sessionString: saveSession(client),
      phoneCodeHash: result.phoneCodeHash,
      codeDelivery: result.isCodeViaApp ? "telegram_app" : "sms"
    };
  } finally {
    await client.disconnect();
  }
}

export async function completeTelegramLoginWithCode(credentials: TelegramApiCredentials, input: {
  sessionString: string;
  phone: string;
  phoneCodeHash: string;
  code: string;
}): Promise<LoginCodeResult> {
  const client = createClient(credentials, input.sessionString);

  try {
    await client.connect();
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: input.phone,
        phoneCodeHash: input.phoneCodeHash,
        phoneCode: input.code
      })
    );
    return { kind: "authorized", sessionString: saveSession(client), profile: profileFromUser(await client.getMe()) };
  } catch (error) {
    if (errorMessage(error).includes("SESSION_PASSWORD_NEEDED")) {
      return { kind: "password_required", sessionString: saveSession(client) };
    }
    throw error;
  } finally {
    await client.disconnect();
  }
}

export async function completeTelegramLoginWithPassword(credentials: TelegramApiCredentials, sessionString: string, password: string) {
  const client = createClient(credentials, sessionString);

  try {
    await client.connect();
    await client.signInWithPassword(
      { apiId: credentials.apiId, apiHash: credentials.apiHash },
      {
        password: async () => password,
        onError: async (error) => {
          throw error;
        }
      }
    );
    return { sessionString: saveSession(client), profile: profileFromUser(await client.getMe()) };
  } finally {
    await client.disconnect();
  }
}

const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;

function splitTelegramMessage(message: string) {
  const chunks: string[] = [];
  let remaining = message.trim();
  while (remaining.length > TELEGRAM_TEXT_LIMIT) {
    let splitAt = remaining.lastIndexOf("\n", TELEGRAM_TEXT_LIMIT);
    if (splitAt < TELEGRAM_TEXT_LIMIT * 0.6) splitAt = remaining.lastIndexOf(" ", TELEGRAM_TEXT_LIMIT);
    if (splitAt < 1) splitAt = TELEGRAM_TEXT_LIMIT;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function splitCaptionAndText(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return { caption: "", remaining: "" };
  if (trimmed.length <= TELEGRAM_CAPTION_LIMIT) return { caption: trimmed, remaining: "" };
  let splitAt = trimmed.lastIndexOf("\n", TELEGRAM_CAPTION_LIMIT);
  if (splitAt < TELEGRAM_CAPTION_LIMIT * 0.6) splitAt = trimmed.lastIndexOf(" ", TELEGRAM_CAPTION_LIMIT);
  if (splitAt < 1) splitAt = TELEGRAM_CAPTION_LIMIT;
  return {
    caption: trimmed.slice(0, splitAt).trim(),
    remaining: trimmed.slice(splitAt).trim()
  };
}

function extensionForMime(mimeType: string, mediaType = "") {
  const clean = mimeType.toLowerCase().split(";")[0].trim();
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/pdf": "pdf"
  };
  return known[clean] || (mediaType === "video" ? "mp4" : mediaType === "image" ? "jpg" : "bin");
}

function inlineMediaFile(mediaUrl: string, mediaType = "") {
  const trimmed = mediaUrl.trim();
  if (!trimmed) return null;

  const dataUrl = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
  if (!dataUrl) {
    throw new Error("Media URL must be a direct http(s) URL or a base64 data URL.");
  }
  const mimeType = dataUrl[1];
  const buffer = Buffer.from(dataUrl[2], "base64");
  if (!buffer.length) throw new Error("Media data is empty.");
  return new CustomFile(`telegram-post.${extensionForMime(mimeType, mediaType)}`, buffer.length, "", buffer);
}

type TelegramMediaDependencies = {
  fetcher?: typeof fetch;
  resolver?: (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string }>>;
  tempRoot?: string;
  maxBytes?: number;
};

type PreparedTelegramMedia = {
  file: CustomFile;
  cleanup: () => Promise<void>;
};

export function telegramMediaMaxBytes() {
  const configured = Number(process.env.TELEGRAM_MEDIA_MAX_BYTES);
  if (!Number.isFinite(configured) || configured < 1) return 2 * 1024 * 1024 * 1024;
  return Math.min(Math.floor(configured), 4 * 1024 * 1024 * 1024);
}

function telegramMediaDownloadTimeout() {
  const configured = Number(process.env.TELEGRAM_MEDIA_DOWNLOAD_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return 20 * 60_000;
  return Math.max(30_000, Math.min(60 * 60_000, Math.floor(configured)));
}

function privateIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0);
}

function privateNetworkAddress(address: string) {
  const clean = address.toLowerCase().split("%")[0];
  if (clean.startsWith("::ffff:")) return privateIpv4(clean.slice("::ffff:".length));
  if (isIP(clean) === 4) return privateIpv4(clean);
  if (isIP(clean) !== 6) return true;
  return clean === "::"
    || clean === "::1"
    || clean.startsWith("fc")
    || clean.startsWith("fd")
    || /^fe[89ab]/.test(clean)
    || clean.startsWith("2001:db8:");
}

async function assertPublicTelegramMediaUrl(
  url: URL,
  resolver: NonNullable<TelegramMediaDependencies["resolver"]>,
) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Telegram media must use an http(s) URL or base64 data URL.");
  if (url.username || url.password) throw new Error("Telegram media URLs cannot contain embedded credentials.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Telegram media URLs must use a public host.");
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolver(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(result => privateNetworkAddress(result.address))) {
    throw new Error("Telegram media URLs cannot point to this server or another private network.");
  }
}

function safeTelegramMediaName(url: URL, mimeType: string, mediaType: string) {
  let candidate = "telegram-post";
  try { candidate = decodeURIComponent(path.basename(url.pathname)) || candidate; } catch { /* Keep the safe fallback. */ }
  candidate = candidate.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 120) || "telegram-post";
  if (!path.extname(candidate)) candidate += `.${extensionForMime(mimeType, mediaType)}`;
  return candidate;
}

/**
 * Downloads public media to this Ubuntu host before handing it to Telegram.
 * This avoids Telegram's WEBPAGE_CURL_FAILED response for temporary tunnel
 * URLs and ensures that the connected account uploads the actual file bytes.
 */
export async function prepareTelegramMedia(
  mediaUrl: string,
  mediaType = "",
  dependencies: TelegramMediaDependencies = {},
): Promise<PreparedTelegramMedia | null> {
  const trimmed = mediaUrl.trim();
  if (!trimmed) return null;
  if (/^data:/i.test(trimmed)) {
    const file = inlineMediaFile(trimmed, mediaType);
    return file ? { file, cleanup: async () => undefined } : null;
  }

  let current: URL;
  try { current = new URL(trimmed); } catch { throw new Error("Media URL must be a direct public http(s) URL or a base64 data URL."); }
  const fetcher = dependencies.fetcher || fetch;
  const resolver = dependencies.resolver || dnsLookup;
  const maxBytes = dependencies.maxBytes || telegramMediaMaxBytes();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Telegram media download timed out.")), telegramMediaDownloadTimeout());
  timeout.unref();
  let directory = "";
  try {
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await assertPublicTelegramMediaUrl(current, resolver);
      response = await fetcher(current, { redirect: "manual", signal: controller.signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("The Telegram media URL returned an invalid redirect.");
      if (redirects === 5) throw new Error("The Telegram media URL redirected too many times.");
      current = new URL(location, current);
      response = null;
    }
    if (!response?.ok) throw new Error(`The Telegram media URL returned HTTP ${response?.status || 502}.`);
    if (!response.body) throw new Error("The Telegram media URL returned no file data.");
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw new Error("The Telegram media exceeds the configured Telegram upload size.");
    }
    const mimeType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (mimeType === "text/html") throw new Error("The Telegram media URL returned a web page instead of a media file.");

    directory = await mkdtemp(path.join(dependencies.tempRoot || os.tmpdir(), "agenticthat-telegram-media-"));
    const fileName = safeTelegramMediaName(current, mimeType, mediaType);
    const filePath = path.join(directory, fileName);
    const handle = await open(filePath, "wx", 0o600);
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new Error("The Telegram media exceeds the configured Telegram upload size.");
        await handle.write(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      await handle.close();
    }
    if (!size) throw new Error("The Telegram media URL returned an empty file.");
    return {
      file: new CustomFile(fileName, size, filePath),
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    if (controller.signal.aborted) throw new Error("Telegram media download timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function telegramMediaSendOptions(mediaType = "") {
  const normalized = mediaType.trim().toLowerCase();
  return {
    forceDocument: normalized === "document" || normalized === "forwarded",
    voiceNote: normalized === "voice",
    videoNote: normalized === "video_note",
    supportsStreaming: normalized === "video",
  };
}
function floodWaitSeconds(error: unknown) {
  if (error && typeof error === "object" && "seconds" in error) {
    const seconds = Number((error as { seconds: unknown }).seconds);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  const match = errorMessage(error).match(/wait of (\d+) seconds|FLOOD_WAIT_(\d+)/i);
  const seconds = Number(match?.[1] || match?.[2] || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

async function inputEntityFromUser(client: TelegramClient, user: Api.User) {
  return client.getInputEntity(user);
}

function userMatchesPhone(user: Api.User, phone: string) {
  return Boolean(user.phone) && `+${user.phone?.replace(/\D/g, "")}` === phone;
}

async function resolvePhoneFromTelegramContacts(client: TelegramClient, phone: string) {
  const contacts = await client.invoke(new Api.contacts.GetContacts({ hash: bigInt.zero }));
  if (!(contacts instanceof Api.contacts.Contacts)) return null;
  const user = contacts.users.find(
    (item): item is Api.User => item instanceof Api.User && userMatchesPhone(item, phone)
  );
  return user ? inputEntityFromUser(client, user) : null;
}

async function resolvePhoneFromTelegramDialogs(client: TelegramClient, phone: string) {
  for await (const dialog of client.iterDialogs({ limit: 500 })) {
    const entity = dialog.entity;
    if (entity instanceof Api.User && userMatchesPhone(entity, phone)) {
      return inputEntityFromUser(client, entity);
    }
  }
  return null;
}

async function resolveExistingPhoneContact(client: TelegramClient, phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  const lookups = [phone, phone.slice(1)];

  for (const lookup of lookups) {
    try {
      return await client.getInputEntity(lookup);
    } catch {
      // Try the next non-importing lookup before falling back to ResolvePhone.
    }
  }

  try {
    const resolved = await client.invoke(new Api.contacts.ResolvePhone({ phone: phone.slice(1) }));
    const users = "users" in resolved ? resolved.users : [];
    const user = users.find((item): item is Api.User => item instanceof Api.User);
    if (user) return inputEntityFromUser(client, user);
  } catch (error) {
    const seconds = floodWaitSeconds(error);
    if (seconds) {
      throw new Error(`Telegram asked to wait ${seconds} seconds before resolving this phone number. Use the contact's @username if available, or try again after ${seconds} seconds.`);
    }
    // The recipient may still be an existing contact or dialog whose phone is
    // available to this connected account, so inspect those authoritative
    // collections before attempting a new contact import.
  }

  const contact = await resolvePhoneFromTelegramContacts(client, phone).catch(() => null);
  if (contact) return contact;
  const dialog = await resolvePhoneFromTelegramDialogs(client, phone).catch(() => null);
  if (dialog) return dialog;
  throw new Error("Telegram could not resolve this phone number from the account's contacts or existing chats.");
}

async function importPhoneContact(client: TelegramClient, input: SendMessageInput) {
  const phone = normalizePhone(input.recipient);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const clientId = bigInt(Date.now()).multiply(1000).add(Math.floor(Math.random() * 1000));
    let result;
    try {
      result = await client.invoke(
        new Api.contacts.ImportContacts({
          contacts: [
            new Api.InputPhoneContact({
              clientId,
              phone: phone.slice(1),
              firstName: input.firstName?.trim() || "Telegram",
              lastName: input.lastName?.trim() || "Contact"
            })
          ]
        })
      );
    } catch (error) {
      const seconds = floodWaitSeconds(error);
      if (seconds) {
        throw new Error(`Telegram asked to wait ${seconds} seconds before importing this phone contact. Use the contact's @username if available, or try again after ${seconds} seconds.`);
      }
      throw error;
    }
    const imported = "imported" in result ? result.imported : [];
    const users = "users" in result ? result.users : [];
    const userId = imported[0]?.userId?.toString();
    const user = users.find(
      (item): item is Api.User => item instanceof Api.User && (!userId || item.id.toString() === userId)
    );
    if (user) return inputEntityFromUser(client, user);

    // Importing can update Telegram's server-side contact list even when the
    // immediate response omits the entity. Re-read the exact phone before
    // concluding that the recipient's privacy setting prevents discovery.
    const refreshed = await resolvePhoneFromTelegramContacts(client, phone).catch(() => null);
    if (refreshed) return refreshed;

    const retryContacts = "retryContacts" in result ? result.retryContacts : [];
    const shouldRetry = retryContacts.some(value => value.toString() === clientId.toString());
    if (!shouldRetry) break;
  }

  throw new Error("Telegram's phone privacy prevented this account from being resolved. Ask the recipient to message the connected account first, or save the recipient's @username and retry.");
}

async function resolveMessagePeer(client: TelegramClient, input: SendMessageInput, allowImport: boolean) {
  const recipient = input.recipient.trim();
  if (!recipient.startsWith("+")) {
    return client.getInputEntity(recipient.startsWith("@") ? recipient.slice(1) : recipient);
  }

  try {
    return await resolveExistingPhoneContact(client, recipient);
  } catch (error) {
    if (!allowImport || /asked to wait \d+ seconds/i.test(errorMessage(error))) throw error;
  }

  return importPhoneContact(client, input);
}

export async function sendTelegramMessage(credentials: TelegramApiCredentials, sessionString: string, input: SendMessageInput): Promise<SentMessage> {
  const recipient = input.recipient.trim();
  const message = input.message.trim();
  if (!recipient) throw new Error("Recipient is required.");
  const preparedMedia = input.mediaFile
    ? {
        file: new CustomFile(input.mediaFile.name, input.mediaFile.size, input.mediaFile.path),
        cleanup: async () => undefined,
      }
    : await prepareTelegramMedia(input.mediaUrl || "", input.mediaType || "");
  const mediaFile = preparedMedia?.file || null;
  if (!message && !mediaFile) throw new Error("Message or media is required.");

  const client = createClient(credentials, sessionString);
  try {
    await client.connect();
    const currentUser = await client.getMe();
    const peer = recipient.startsWith("+") && telegramPhoneMatchesUser(recipient, currentUser.phone || "")
      ? await inputEntityFromUser(client, currentUser)
      : await resolveMessagePeer(client, input, true);
    const sentIds: string[] = [];
    const textChunks = mediaFile ? [] : splitTelegramMessage(message);
    if (mediaFile) {
      const { caption, remaining } = splitCaptionAndText(message);
      const sendOptions = telegramMediaSendOptions(input.mediaType);
      const sent = await client.sendFile(peer, {
        file: mediaFile,
        caption,
        ...sendOptions,
      });
      if (sent.id) sentIds.push(sent.id.toString());
      textChunks.push(...splitTelegramMessage(remaining));
    }
    for (const chunk of textChunks) {
      const sent = await client.sendMessage(peer, { message: chunk });
      if (sent.id) sentIds.push(sent.id.toString());
    }
    if (!sentIds.length) {
      throw new Error("Telegram did not return a message ID, so delivery could not be confirmed.");
    }
    return { recipient, messageId: sentIds.join(","), sentAt: new Date().toISOString() };
  } finally {
    try {
      await client.disconnect();
    } finally {
      await preparedMedia?.cleanup();
    }
  }
}

export async function revokeTelegramSession(credentials: TelegramApiCredentials, sessionString: string) {
  const client = createClient(credentials, sessionString);
  try {
    await client.connect();
    await client.invoke(new Api.auth.LogOut());
  } finally {
    await client.disconnect();
  }
}

function userReferences(user: Api.User) {
  return [
    user.phone ? (user.phone.startsWith("+") ? user.phone : `+${user.phone}`) : "",
    user.username ? `@${user.username}` : "",
    user.id.toString()
  ].filter(Boolean);
}

function senderReference(sender: unknown) {
  return sender instanceof Api.User ? userReferences(sender).join(" ") : "";
}

function peerReference(peer: unknown) {
  if (peer instanceof Api.User) return senderReference(peer);
  if (peer instanceof Api.Channel) return [peer.username ? `@${peer.username}` : "", peer.id.toString()].filter(Boolean).join(" ");
  if (peer instanceof Api.Chat) return peer.id.toString();
  return "";
}

function telegramMessageDate(message: Api.Message) {
  const value = message.date;
  return typeof value === "number" ? new Date(value * 1000).toISOString() : new Date().toISOString();
}

function telegramMessageText(message: Api.Message) {
  return (message.message ?? "").trim();
}

export async function listenForAccount(
  credentials: TelegramApiCredentials,
  sessionString: string,
  onIncomingMessage: (input: IncomingTelegramMessage) => Promise<void>
) {
  const client = createClient(credentials, sessionString);
  await client.connect();
  await client.getMe();
  client.addEventHandler(async (event: unknown) => {
    const message = (event as { message?: Api.Message }).message;
    if (!message || message.out) return;
    try {
      const sender = await message.getSender();
      const chat = await message.getChat().catch(() => null);
      const isPrivate = (message as { isPrivate?: boolean }).isPrivate !== false;
      await onIncomingMessage({
        chatId: message.chatId?.toString() ?? "",
        chatRef: peerReference(chat),
        senderId: sender instanceof Api.User ? sender.id.toString() : "",
        senderRef: senderReference(sender),
        isPrivate,
        messageId: message.id?.toString() ?? "",
        text: telegramMessageText(message),
        createdAt: telegramMessageDate(message)
      });
    } catch (error) {
      console.error(`Unable to save an incoming Telegram message: ${errorMessage(error)}`);
    }
  }, new NewMessage({ incoming: true }));
  return client;
}
async function resolveUserMessagePeer(client: TelegramClient, recipient: string) {
  const target = recipient.trim();
  if (!target) return null;
  try {
    if (target.startsWith("+")) {
      const peer = await resolveMessagePeer(client, { recipient: target, message: "sync" }, false);
      const entity = await client.getEntity(peer);
      return entity instanceof Api.User ? { peer, references: [target, ...userReferences(entity)] } : null;
    }

    const lookup = target.startsWith("@") ? target.slice(1) : target;
    const entity = await client.getEntity(lookup);
    if (!(entity instanceof Api.User)) return null;
    return { peer: await client.getInputEntity(entity), references: [target, ...userReferences(entity)] };
  } catch {
    return null;
  }
}

export async function fetchRecentTelegramMessages(credentials: TelegramApiCredentials, sessionString: string, limit = 100, recipients: string[] = []): Promise<SyncedTelegramMessage[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const targets = [...new Set(recipients.map((recipient) => recipient.trim()).filter(Boolean))];
  if (!targets.length) return [];
  const perTargetLimit = Math.min(50, Math.max(10, Math.ceil(safeLimit / Math.max(targets.length, 1))));
  const client = createClient(credentials, sessionString);

  try {
    await client.connect();
    await client.getMe();
    const messages: SyncedTelegramMessage[] = [];

    for (const target of targets) {
      const resolved = await resolveUserMessagePeer(client, target);
      if (!resolved) continue;
      const recipientRef = [...new Set(resolved.references)].join(" ");
      const history = await client.getMessages(resolved.peer, { limit: perTargetLimit });
      for (const item of history) {
        if (!(item instanceof Api.Message)) continue;
        const text = telegramMessageText(item);
        if (!text) continue;
        const messageId = item.id?.toString() ?? "";
        if (!messageId) continue;
        messages.push({
          direction: item.out ? "outbound" : "inbound",
          recipient: recipientRef,
          messageId,
          text,
          createdAt: telegramMessageDate(item)
        });
      }
    }

    return messages
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, safeLimit);
  } finally {
    await client.disconnect();
  }
}
