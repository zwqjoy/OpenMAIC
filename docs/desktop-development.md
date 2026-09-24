# Desktop development

Install dependencies with `pnpm install`.

- Web: `pnpm dev`
- Desktop: `pnpm desktop:dev`

The P0 Electron host starts the existing Next.js app locally and loads it in a
secure BrowserWindow. It currently depends on Node.js >= 22.19, pnpm, and the
project's installed dependencies on the development machine. A bundled Node
runtime and installers are planned for a later phase.
