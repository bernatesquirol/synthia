/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Presign endpoint baked in at build time; see config.persistence. */
  readonly VITE_PRESIGN_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
