# Sherlock for Zed

Source-language previews and message extraction for Paraglide projects, powered by the official inlang SDK.

- Hover over `m.key()` to preview the source message.
- Select text and open code actions to extract it into a message with an automatically generated key.
- Rename static message references across code and translation catalogs.

Supports JavaScript, TypeScript and JSX/TSX, with inlang message-format 4.4/4.5 projects.

## Installation

With Rust installed through rustup, open Zed's Extensions page, choose **Install Dev Extension**, and select this repository.

Sherlock uses Zed's managed Node.js runtime and automatically downloads its versioned language server. No manual LSP path is required. Supported platforms: macOS ARM64/x64, Linux ARM64/x64 (glibc), and Windows x64.

## Development

Requires Node.js 24+ and Rust.

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run test:release
npm run build
cargo test --locked
rustup target add wasm32-wasip2
cargo build --locked --target wasm32-wasip2 --release
```

Tagged releases build and test native server archives on all supported platforms, then prepare a GitHub release draft for manual publication.
