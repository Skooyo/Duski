/** First message to the Ask window: what the question is about, and its preset buttons. */
export type AskInit =
  | { kind: 'text'; text: string; presets: [label: string, instruction: string][] }
  | { kind: 'image'; image: string; presets: [label: string, instruction: string][] };

/** Messages from main to the Ask window while an answer runs. */
export type AskEvent =
  | { kind: 'status'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'done'; canContinue: boolean };
