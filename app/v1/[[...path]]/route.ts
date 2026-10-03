import { handleTelegramRequest } from "../../../src/platform/server/telegram-proxy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export { handleTelegramRequest as GET, handleTelegramRequest as POST, handleTelegramRequest as PUT, handleTelegramRequest as PATCH, handleTelegramRequest as DELETE, handleTelegramRequest as OPTIONS, handleTelegramRequest as HEAD };
