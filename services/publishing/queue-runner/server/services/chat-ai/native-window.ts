// Keeps the AI browser windows out of the Windows taskbar and Alt+Tab while
// they work in the background, and brings one back when the user is needed.
// The window stays "shown" (just off screen, as a tool window), so Chrome keeps
// rendering and running the page at full speed; hiding it outright would not.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = String.raw`param([int]$ProcessId, [string]$Mode)
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AgenticThatWindows {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  const int GWL_EXSTYLE = -20;
  const long WS_EX_TOOLWINDOW = 0x80;
  const long WS_EX_APPWINDOW = 0x40000;
  public static int Apply(uint processId, bool background) {
    int changed = 0;
    EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {
      uint owner;
      GetWindowThreadProcessId(hWnd, out owner);
      if (owner != processId) return true;
      StringBuilder name = new StringBuilder(64);
      GetClassName(hWnd, name, 64);
      if (name.ToString() != "Chrome_WidgetWin_1" || GetWindowTextLength(hWnd) == 0) return true;
      long style = GetWindowLongPtr(hWnd, GWL_EXSTYLE).ToInt64();
      long next = background ? (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW : (style & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW;
      if (next != style) {
        // The taskbar only notices a style change when the window is shown again.
        ShowWindow(hWnd, 0);
        SetWindowLongPtr(hWnd, GWL_EXSTYLE, new IntPtr(next));
        ShowWindow(hWnd, background ? 4 : 5);
      }
      if (!background) SetForegroundWindow(hWnd);
      changed++;
      return true;
    }, IntPtr.Zero);
    return changed;
  }
}
"@
[AgenticThatWindows]::Apply([uint32]$ProcessId, $Mode -eq "background")
`;

let scriptPath = "";

function script() {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  scriptPath = path.join(os.tmpdir(), "agenticthat-ai-window.ps1");
  fs.writeFileSync(scriptPath, SCRIPT);
  return scriptPath;
}

/**
 * Windows only: "background" takes the browser's windows out of the taskbar and
 * Alt+Tab; "foreground" puts them back and brings them to the front. Returns how
 * many windows were changed (0 when the window has no title yet, or elsewhere).
 */
export function setWindowPresence(processId: number | undefined, presence: "background" | "foreground"): Promise<number> {
  if (process.platform !== "win32" || !processId) return Promise.resolve(0);
  return new Promise((resolve) => {
    let output = "";
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script(), "-ProcessId", String(processId), "-Mode", presence], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill();
      resolve(0);
    }, 15_000);
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", () => { clearTimeout(timer); resolve(0); });
    child.on("exit", () => {
      clearTimeout(timer);
      resolve(Number.parseInt(output.trim(), 10) || 0);
    });
  });
}
