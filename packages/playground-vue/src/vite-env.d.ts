/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // biome-ignore lint/complexity/noBannedTypes: vite types
  // biome-ignore lint/suspicious/noExplicitAny: vite types
  const component: DefineComponent<{}, {}, any>
  // biome-ignore lint/style/noDefaultExport: vite types
  export default component
}
