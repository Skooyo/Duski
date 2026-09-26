/** Messages from main to the chat window. Main keeps the list, so a reopened window can replay it. */
export type ChatEvent =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; summary: string; name: string; input: string }
  | { kind: 'tool-result'; id: string; output: string; isError: boolean }
  | { kind: 'error'; text: string }
  | { kind: 'done' };
