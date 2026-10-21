// Tauri's documented global API, injected locally by withGlobalTauri. No
// runtime npm package, remote script, or browser-side native fallback.
interface NativeWindow {
  close(): Promise<void>;
  startDragging(): Promise<void>;
}
declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
      };
      window: { getCurrentWindow(): NativeWindow };
    };
  }
}
export const native = window.__TAURI__ !== undefined;
export function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!window.__TAURI__)
    return Promise.reject(new Error("Native API unavailable."));
  return window.__TAURI__.core.invoke<T>(command, args);
}
export function getCurrentWindow(): NativeWindow {
  if (!window.__TAURI__) throw new Error("Native window unavailable.");
  return window.__TAURI__.window.getCurrentWindow();
}
