export type ExternalBrowserWorkspaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExternalBrowserTile = {
  index: number;
  total: number;
  row: number;
  column: number;
  rows: number;
  columns: number;
  centered: boolean;
  bounds: ExternalBrowserWorkspaceBounds;
};

const workspaceMargin = 10;
const tileGap = 10;

export function externalBrowserTileLayout(
  workspace: ExternalBrowserWorkspaceBounds,
  count: number,
): ExternalBrowserTile[] {
  if (!Number.isInteger(count) || count < 1) return [];

  const columns = count === 1 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const innerWidth = Math.max(columns, workspace.width - (workspaceMargin * 2) - (tileGap * (columns - 1)));
  const innerHeight = Math.max(rows, workspace.height - (workspaceMargin * 2) - (tileGap * (rows - 1)));
  const tileWidth = Math.max(1, Math.floor(innerWidth / columns));
  const tileHeight = Math.max(1, Math.floor(innerHeight / rows));

  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const isCenteredLastTile = columns === 2 && count % 2 === 1 && index === count - 1;
    const left = isCenteredLastTile
      ? workspace.x + Math.floor((workspace.width - tileWidth) / 2)
      : workspace.x + workspaceMargin + (column * (tileWidth + tileGap));
    const top = workspace.y + workspaceMargin + (row * (tileHeight + tileGap));

    return {
      index: index + 1,
      total: count,
      row: row + 1,
      column: isCenteredLastTile ? 1 : column + 1,
      rows,
      columns,
      centered: isCenteredLastTile,
      bounds: {
        x: left,
        y: top,
        width: tileWidth,
        height: tileHeight,
      },
    };
  });
}
