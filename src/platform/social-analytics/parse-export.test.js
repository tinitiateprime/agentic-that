import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { AnalyticsImportError, parseCsv, readAnalyticsExport, toDate, toNumber } from "./parse-export.js";

const bytes = (text) => new TextEncoder().encode(text);

test("CSV: quotes, commas and line breaks inside a caption", () => {
  const rows = parseCsv('﻿Title,Likes\r\n"Launch day, at last!\nJoin us",1,234\r\n"He said ""hi""",5\r\n');
  assert.deepEqual(rows[1], ["Launch day, at last!\nJoin us", "1", "234"]);
  assert.deepEqual(rows[2], ['He said "hi"', "5"]);
});

test("numbers and dates as exports write them", () => {
  assert.equal(toNumber("1,234"), 1234);
  assert.equal(toNumber("12.5%"), 12.5);
  assert.equal(toNumber("1.2K"), 1200);
  assert.equal(toNumber(""), null);
  assert.equal(toNumber("--"), null);
  assert.equal(toDate("2026-11-20 18:05"), "2026-11-20T18:05:00.000Z");
  assert.equal(toDate("11/20/2026 06:05 PM"), "2026-11-20T18:05:00.000Z");
  assert.equal(toDate("Nov 20, 2026"), "2026-11-20T00:00:00.000Z");
  assert.equal(toDate("46346"), "2026-11-20T00:00:00.000Z", "Excel serial date");
});

test("Instagram from Meta Business Suite: detected by its links, 'Lifetime' date column ignored", async () => {
  const csv = [
    "Post ID,Account ID,Account username,Account name,Description,Duration (sec),Publish time,Permalink,Post type,Data comment,Date,Views,Reach,Likes,Shares,Follows,Comments,Saves",
    '17900001,1789,tinitiate,Tinitiate,"Off-campus placement guide, 5 steps",0,11/20/2026 18:05,https://www.instagram.com/p/ABC123/,IG image,,Lifetime,"1,520",980,64,9,3,12,30',
    "17900002,1789,tinitiate,Tinitiate,Batch 5 starts Monday,12,11/18/2026 09:30,https://www.instagram.com/reel/XYZ/,IG reel,,Lifetime,8400,6100,310,44,21,27,90",
  ].join("\n");
  const result = await readAnalyticsExport({ fileName: "Nov-20-2026.csv", bytes: bytes(csv) });
  assert.equal(result.platform, "instagram");
  assert.equal(result.posts.length, 2);
  const [first] = result.posts;
  assert.equal(first.postKey, "17900001");
  assert.equal(first.account, "tinitiate");
  assert.equal(first.text, "Off-campus placement guide, 5 steps");
  assert.equal(first.publishedAt, "2026-11-20T18:05:00.000Z");
  assert.equal(first.type, "IG image");
  assert.deepEqual(first.metrics, { views: 1520, reach: 980, likes: 64, comments: 12, shares: 9, saves: 30, follows: 3 });
});

test("Facebook from Meta Business Suite: Reactions count as likes", async () => {
  const csv = "Post ID,Page name,Title,Publish time,Permalink,Post type,Reach,Reactions,Comments,Shares,Total clicks\n"
    + "555_1,Tinitiate,New batch,2026-11-19 10:00,https://www.facebook.com/tinitiate/posts/1,Photos,3200,120,8,15,90\n";
  const result = await readAnalyticsExport({ fileName: "export.csv", bytes: bytes(csv) });
  assert.equal(result.platform, "facebook");
  assert.deepEqual(result.posts[0].metrics, { reach: 3200, likes: 120, comments: 8, shares: 15, clicks: 90 });
});

test("YouTube Studio zip: one row per video, the Total row skipped", async () => {
  const zip = new JSZip();
  zip.file("Chart data.csv", "Date,Views\n2026-11-20,100\n");
  zip.file("Table data.csv", [
    "Content,Video title,Video publish time,Duration,Views,Watch time (hours),Subscribers,Impressions,Impressions click-through rate (%)",
    "Total,,,,5400,210.5,40,60000,4.1",
    "dQw4w9WgXcQ,Python in 10 minutes,\"Nov 18, 2026\",612,5000,200.25,38,55000,4.3",
    "aBcDeFgHiJk,Resume tips,\"Nov 20, 2026\",300,400,10.25,2,5000,3.2",
  ].join("\n"));
  const result = await readAnalyticsExport({ fileName: "Content 2026-11-01_2026-11-24.zip", bytes: await zip.generateAsync({ type: "uint8array" }) });
  assert.equal(result.platform, "youtube");
  assert.equal(result.posts.length, 2);
  assert.equal(result.posts[0].permalink, "https://youtu.be/dQw4w9WgXcQ");
  assert.deepEqual(result.posts[0].metrics, { views: 5000, impressions: 55000, follows: 38, watchHours: 200.25 });
});

test("LinkedIn .xlsx: a title line above the header, the posts sheet chosen over the daily sheet", async () => {
  const sheet = (rows) => `<?xml version="1.0"?><worksheet><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const zip = new JSZip();
  zip.file("xl/worksheets/sheet1.xml", sheet([["Date", "Impressions", "Clicks"], ["11/20/2026", "900", "40"]]));
  zip.file("xl/worksheets/sheet2.xml", sheet([
    ["All posts. Data for the last 30 days"],
    ["Update title", "Update link", "Update type", "Created date", "Impressions", "Clicks", "Likes", "Comments", "Reposts", "Follows", "Engagement rate"],
    ["We are hiring trainers &amp; mentors", "https://www.linkedin.com/feed/update/urn:li:activity:1", "Organic", "11/19/2026", "2,300", "85", "60", "7", "4", "5", "6.8%"],
  ]));
  const result = await readAnalyticsExport({ fileName: "tinitiate_content.xlsx", bytes: await zip.generateAsync({ type: "uint8array" }) });
  assert.equal(result.platform, "linkedin");
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].text, "We are hiring trainers & mentors");
  assert.deepEqual(result.posts[0].metrics, { impressions: 2300, likes: 60, comments: 7, shares: 4, clicks: 85, follows: 5 });
});

test("X export: detected by its status links", async () => {
  const csv = "Post id,Date,Post text,Post Link,Impressions,Likes,Engagements,Bookmarks,Shares,New follows,Replies,Reposts,Profile visits\n"
    + "1990001,\"Thu, Nov 20, 2026\",Batch 5 is open,https://x.com/tinitiate/status/1990001,4100,52,130,6,3,2,9,11,20\n";
  const result = await readAnalyticsExport({ fileName: "account_analytics_content.csv", bytes: bytes(csv) });
  assert.equal(result.platform, "x");
  assert.equal(result.posts[0].metrics.impressions, 4100);
  assert.equal(result.posts[0].metrics.comments, 9, "Replies are comments");
  assert.equal(result.posts[0].metrics.saves, 6, "Bookmarks are saves");
});

test("clear errors for files that aren't post analytics", async () => {
  await assert.rejects(readAnalyticsExport({ fileName: "photo.png", bytes: bytes("x") }), AnalyticsImportError);
  await assert.rejects(readAnalyticsExport({ fileName: "old.xls", bytes: bytes("x") }), /save it as \.xlsx or \.csv/);
  await assert.rejects(readAnalyticsExport({ fileName: "contacts.csv", bytes: bytes("Name,Phone\nAsha,123\n") }), /doesn't look like a social analytics export/);
  await assert.rejects(readAnalyticsExport({ fileName: "data.csv", bytes: bytes("Title,Views\nHello,10\n") }), /Couldn't tell which platform/);
  const chosen = await readAnalyticsExport({ fileName: "data.csv", bytes: bytes("Title,Views\nHello,10\n"), platform: "facebook" });
  assert.equal(chosen.platform, "facebook");
});

test("YouTube: videos with no views in the period are kept, 'Thumbnail impressions' read", async () => {
  const zip = new JSZip();
  zip.file("Table data.csv", [
    "Content,Video title,Video publish time,Duration,Views,Watch time (hours),Subscribers,Thumbnail impressions,Thumbnail click-through rate (%)",
    "Total,,,,44,0.3625,0,3545,0.39",
    "znV7qIA5c4s,\"SQL Server setup | 5 Tables\",\"Nov 18, 2026\",897,44,0.3625,0,3512,0.4",
    "TWnXUvQhLio,pppppppppppppp,\"Sep 15, 2026\",121,,,,11,0",
    "uD4F4h1mLLE,yt aws test,\"Oct 3, 2026\",121,,,,,",
  ].join("\n"));
  zip.file("Totals.csv", "Date,Views\n2026,44\n");
  const result = await readAnalyticsExport({ fileName: "Content.zip", bytes: await zip.generateAsync({ type: "uint8array" }) });
  assert.equal(result.posts.length, 3, "every video, even with blank numbers");
  assert.deepEqual(result.posts[0].metrics, { views: 44, impressions: 3512, follows: 0, watchHours: 0.3625 });
  assert.deepEqual(result.posts[1].metrics, { impressions: 11 });
  assert.deepEqual(result.posts[2].metrics, {}, "nothing recorded in the period is 0, not a missing video");
});

test("posts with no numbers are kept on every platform; description rows and summaries are not", async () => {
  const instagram = "Post ID,Description,Publish time,Permalink,Views,Reach,Likes\n"
    + "Post ID,Post caption,When it was posted,Link,The number of times your post was played,Accounts reached,Number of likes\n"
    + "p1,Quiet post,2026-11-01 10:00,https://www.instagram.com/p/Q1/,,,\n"
    + "p2,Busy post,2026-11-02 10:00,https://www.instagram.com/p/Q2/,500,300,20\n";
  const ig = await readAnalyticsExport({ fileName: "ig.csv", bytes: bytes(instagram) });
  assert.deepEqual(ig.posts.map((post) => post.postKey), ["p1", "p2"], "the describing row is skipped; the quiet post is kept");

  const x = "Post id,Date,Post text,Post Link,Impressions,Likes\n1,2026-11-01,Hello,https://x.com/a/status/1,,\n";
  assert.equal((await readAnalyticsExport({ fileName: "x.csv", bytes: bytes(x) })).posts.length, 1);
});

test("LinkedIn's '(organic)' and '(total)' columns are read", async () => {
  const csv = "Update title,Update link,Created date,Impressions (organic),Clicks (organic),Reactions (organic),Comments (organic),Reposts (organic),Impressions (sponsored)\n"
    + "Hiring,https://www.linkedin.com/feed/update/1,11/19/2026,2300,85,60,7,4,900\n";
  const result = await readAnalyticsExport({ fileName: "li.csv", bytes: bytes(csv) });
  assert.equal(result.platform, "linkedin");
  assert.deepEqual(result.posts[0].metrics, { impressions: 2300, likes: 60, comments: 7, shares: 4, clicks: 85 }, "sponsored numbers are not mixed in");
});
