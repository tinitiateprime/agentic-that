import assert from "node:assert/strict";
import test from "node:test";
import { externalBrowserTileLayout } from "./engines/external-browser/layout.js";

test("external browsers fill a stable two-column grid", () => {
  const tiles = externalBrowserTileLayout({ x: 0, y: 0, width: 1920, height: 1040 }, 4);

  assert.equal(tiles.length, 4);
  assert.deepEqual(tiles.map(tile => [tile.row, tile.column]), [[1, 1], [1, 2], [2, 1], [2, 2]]);
  assert.ok(tiles.every(tile => tile.bounds.width === 945 && tile.bounds.height === 505));
  assert.ok(tiles.every(tile => tile.bounds.x >= 0 && tile.bounds.y >= 0));
  assert.ok(tiles.every(tile => tile.bounds.x + tile.bounds.width <= 1920));
  assert.ok(tiles.every(tile => tile.bounds.y + tile.bounds.height <= 1040));
});

test("an odd final external browser is centered on its row", () => {
  const tiles = externalBrowserTileLayout({ x: 100, y: 40, width: 1400, height: 900 }, 3);
  const finalTile = tiles[2];

  assert.equal(finalTile.row, 2);
  assert.equal(finalTile.bounds.x, 457);
  assert.equal(finalTile.bounds.width, 685);
});

test("a single external browser receives the complete usable workspace", () => {
  const [tile] = externalBrowserTileLayout({ x: -1280, y: 0, width: 1280, height: 720 }, 1);

  assert.deepEqual(tile.bounds, { x: -1270, y: 10, width: 1260, height: 700 });
  assert.equal(tile.columns, 1);
  assert.equal(tile.rows, 1);
});

test("five concurrent account windows remain inside three tidy rows", () => {
  const tiles = externalBrowserTileLayout({ x: 0, y: 0, width: 1600, height: 1000 }, 5);
  const finalTile = tiles[4];

  assert.equal(tiles[0].columns, 2);
  assert.equal(tiles[0].rows, 3);
  assert.equal(finalTile.centered, true);
  assert.ok(tiles.every(tile => tile.bounds.x + tile.bounds.width <= 1600));
  assert.ok(tiles.every(tile => tile.bounds.y + tile.bounds.height <= 1000));
});
