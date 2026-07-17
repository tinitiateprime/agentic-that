import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSql } from "./db.js";

export { hashPassword, verifyPassword } from "./password.js";

const COOKIE_NAME = "session";

function cookieAttributes(maxAge) {
  const attrs = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

export function sessionCookieHeader(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(60 * 60 * 24 * 30)}`;
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; ${cookieAttributes(0)}`;
}

// --- Sessions --------------------------------------------------------------
export async function createSession(userId) {
  const sql = await getSql();
  const token = crypto.randomBytes(32).toString("hex");
  await sql`INSERT INTO sessions (token, user_id) VALUES (${token}, ${userId})`;
  return token;
}

export async function destroySession(token) {
  if (!token) return;
  const sql = await getSql();
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

// Reads the session cookie and returns the logged-in user (with business_id), or null.
export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const sql = await getSql();
  const [user] = await sql`
    SELECT u.id, u.name, u.email, u.role, u.business_id
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ${token}`;
  return user || null;
}

// Guard for server components / layouts: redirects to /login when signed out.
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function setSessionCookie(token) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export { COOKIE_NAME };
