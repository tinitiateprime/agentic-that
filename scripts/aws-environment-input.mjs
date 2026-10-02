import { parse } from "dotenv";

export function parseAwsEnvironmentInput(contents) {
  const values = parse(contents);
  // Plain exported documents may place an unquoted PEM on several lines.
  // dotenv accepts quoted multiline values; recover only these two raw PEMs.
  const keys = /^\s*(SERVICE_TOKEN_PRIVATE_KEY|SERVICE_TOKEN_PUBLIC_KEY)\s*=\s*(-----BEGIN ([A-Z ]+)-----\r?\n[\s\S]*?-----END \3-----)/gm;
  for (const match of String(contents).matchAll(keys)) values[match[1]] = match[2].replaceAll("\r\n", "\n");
  return values;
}

export function usableAwsEnvironmentValues(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value?.trim() && !/\*{3,}|<[^>@]+>|YOUR_|^\*+$/.test(value)));
}
