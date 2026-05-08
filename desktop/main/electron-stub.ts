// Stub for 'electron' module used in the agent sub-process (agent-bridge).
// The sub-process is a plain Node.js process without Electron APIs.
// This stub provides safe defaults for the Electron APIs used by auth.ts and api-client.ts.

const stub = {
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (_s: string) => Buffer.from(''),
    decryptString: (_b: Buffer) => '',
  },
  session: {
    defaultSession: {
      cookies: {
        get: async () => [],
        set: async () => {},
      },
    },
  },
  app: {
    getPath: () => '',
    isPackaged: true,
  },
};

export default stub;
export const { safeStorage, session, app } = stub;
