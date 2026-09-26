export {};

declare global {
  interface Window {
    duski: {
      send(channel: string, ...args: unknown[]): void;
      invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
      on(channel: string, fn: (...args: any[]) => void): void;
    };
  }
}
