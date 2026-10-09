/** A file the user dropped into the chat. Claude gets the path; the chat shows name and size. */
export type AttachedFile = { name: string; path: string; size: number };

/** Answer to `chat:preview`: the start of a text file, or why there is no text. */
export type FilePreview = { kind: 'text'; text: string; truncated: boolean } | { kind: 'binary' | 'folder' | 'missing' };

/** Messages from main to the chat window. Main keeps the list, so a reopened window can replay it. */
export type ChatEvent =
  | { kind: 'user'; text: string; images?: string[]; files?: AttachedFile[] } // images: data URLs, kept for replay
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; summary: string; name: string; input: string }
  | { kind: 'tool-result'; id: string; output: string; isError: boolean }
  | { kind: 'error'; text: string }
  | { kind: 'done' };
