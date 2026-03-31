declare module '@babel/standalone' {
  const Babel: any;
  export default Babel;
}

declare global {
  interface Window {
    __WEBOT_API__?: {
      requestJson: <TResponse>(
        path: string,
        options?: {
          method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
          body?: unknown;
          headers?: Record<string, string>;
          signal?: AbortSignal;
          timeoutMs?: number;
        },
      ) => Promise<TResponse>;
    };
  }
}

export {};
