export interface ListRule { name: string; sentinel: string; budget: number }
export interface Chunk { file: string; text: string; gzipped: number }
export declare const kb: (bytes: number) => string;
export declare function checkLists(input: { entry: string[]; chunks: Chunk[]; lists: ListRule[]; rows: Record<string, number> }): {
  problems: string[];
  warnings: string[];
  lines: string[];
};
