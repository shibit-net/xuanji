declare module '@xenova/transformers' {
  export function pipeline(
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ): Promise<any>;

  export const env: {
    cacheDir: string;
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    [key: string]: any;
  };
}
