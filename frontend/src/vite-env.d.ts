/// <reference types="vite/client" />

// Vite `?url` imports resolve to the asset's URL string at build time.
declare module "*?url" {
  const url: string;
  export default url;
}
