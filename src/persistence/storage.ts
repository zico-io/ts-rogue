export interface SaveStorage {
  load(): Promise<string | undefined>;

  save(json: string): Promise<void>;

  clear(): Promise<void>;
}
