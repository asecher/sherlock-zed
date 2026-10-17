# Zed adapter: automatic release and optional local override

The Rust/WASM layer registers server ID `sherlock`. With no `binary` override, it obtains Node through Zed, downloads the pinned platform-specific archive from `asecher/sherlock-zed`, verifies SHA-256 and safely extracts it into a versioned cache before launching the local LSP. It never installs npm packages on the user machine or performs SDK operations against a workspace. Hover, extraction and existing rename behavior live in the Node LSP.

**Availability:** no remote release has been published yet. The automatic path is implemented and tested with local archives, but will fail to download until the matching public release assets exist. Keep a working local override until then. See [release preparation](RELEASE.md).

## Automatic mode

After the release is published and the updated extension is rebuilt/installed, no `lsp.sherlock.binary.path` or `arguments` are required. Remove only an old `lsp.sherlock.binary` object to opt into automatic mode; preserve all other settings and language-server lists. The default never follows `latest`: extension version 0.1.0 requests tag `v0.1.0` and its exact OS/architecture archive plus checksum.

A complete validated cache avoids repeat archive downloads. Invalid/incomplete staging is discarded and retried; errors do not silently select another version. The cache marker and entrypoint digest are checked, but this is not a full per-file hash scan of every installed dependency. The SHA sidecar shares the GitHub release trust channel and is not an independent signature.

Node must be 24+; Linux archives require detected glibc. The implemented targets are macOS arm64/x64, Linux glibc arm64/x64, and Windows x64. Only the macOS arm64 archive has been exercised locally; the other targets require native CI runs. Unsupported targets receive an explicit error and can still use a custom local override.

## Build

Prerequisites: Node **24 or newer**, npm, Rust installed with rustup, and a Zed version supporting `zed_extension_api` 0.7.0. The official compatibility table does not currently give a minimum Zed version for API 0.7.0; do not infer one from older API entries.

From this extension's root:

```sh
npm ci --ignore-scripts
npm run build
rustup target add wasm32-wasip2
cargo test
cargo build --target wasm32-wasip2 --release
cargo fmt --check
```

The server entry point is `server/dist/main.js`. Cargo produces `target/wasm32-wasip2/release/sherlock_zed.wasm` (a WASI Preview 2 component). Keep the local checkout and its Node dependencies available while using the extension. Re-run `npm run build` after changing server sources; rebuilding Rust does not compile TypeScript.

## Optional local development override

Find your actual Node executable with `command -v node`, check `node --version`, and use an **absolute** path to that executable. Also use an absolute server entry-point path. In Zed, manually merge the following fragment into your existing user settings or the target project's `.zed/settings.json`. Replace both placeholders; do not paste this over the whole settings file or add duplicate `lsp` keys.

```json
{
  "lsp": {
    "sherlock": {
      "binary": {
        "path": "/absolute/path/to/node",
        "arguments": [
          "/absolute/path/to/sherlock-zed/server/dist/main.js",
          "--stdio"
        ]
      }
    }
  }
}
```

`binary.path` is **Node**, not the JavaScript file and not the WASM component. `arguments` is an array, not a shell command string: keep paths containing spaces as single array elements, without extra shell quotes. Do not use `~`, `$HOME`, or assume Zed's working directory is this checkout. An optional `binary.env` object supplies explicit process environment overrides. An explicit `binary` override bypasses automatic downloading and Zed runtime probing. To use automatic mode, omit the entire `binary` override rather than leaving an empty object.

In local-override mode, configure **both** path and arguments; an explicit Node executable without its script is not a valid Sherlock launch. A blank/partial override returns setup help; no override selects the automatic path. Zed may handle a configured binary directly, so adapter validation is not a substitute for checking settings.

## Preserve existing language servers and exclusions

Sherlock is supplemental: keep your normal TypeScript/JavaScript server enabled. The manifest registers `TypeScript`, `TSX`, `JavaScript` and `JSX`, mapped respectively to LSP IDs `typescript`, `typescriptreact`, `javascript` and `javascriptreact`. Current built-in Zed classifies `.jsx` files as **JavaScript**, not a separate JSX language; the JSX entry also supports installations that register that name. There is no need to change file associations or install replacement grammars.

Before editing `languages.<language>.language_servers`, inspect the **effective** list, including inherited defaults and any top-level `language_servers` setting. A language-specific array replaces the inherited array; it does not merge with it. Keep every existing named server, exclusion (`!server`) and `"..."` entry in the same order, then append `"sherlock"` once. If `"!sherlock"` is present, remove only that exclusion when intentionally enabling Sherlock.

For example, an existing TypeScript configuration:

```json
"language_servers": ["vtsls", "!typescript-language-server", "..."]
```

becomes:

```json
"language_servers": ["vtsls", "!typescript-language-server", "...", "sherlock"]
```

Do the same for TSX and JavaScript (and JSX only if your Zed installation exposes that language), preserving each language's own list and other settings. If the original list deliberately omits `"..."`, do **not** add it: doing so could enable other servers. Do not replace existing lists with `["sherlock", "..."]`, because this can discard exclusions, change server priority and re-enable unwanted servers. With no custom list, the manifest may already enable Sherlock; only add a language override if needed, based on the effective defaults, not an assumed list.

Leave existing `lsp` entries, `file_scan_exclusions`, `file_scan_inclusions`, search exclusions, ignored paths, formatters and other settings unchanged. This setup does not require modifying any of them.

## Install the dev extension manually

1. Until a release is published, build the Node server and use the local override above. Once a matching release exists, omit that override for automatic installation.
2. Open Zed's Extensions page, choose **Install Dev Extension**, and select the directory containing this project's `extension.toml` and `Cargo.toml`, not `server/` or `target/`.
3. Zed builds the Rust extension. Open your target inlang project and a supported source file; restart the Sherlock language server if you change launch settings.
4. Check **zed: open log** if startup fails. Verify that Node is 24+, the absolute script path exists and was rebuilt, and the relevant effective language-server list includes Sherlock without excluding your regular servers. For launch/protocol debugging, run the configured command in a terminal; it waits for LSP messages on stdin and is not an interactive CLI.

No user/project Zed settings, GitHub uploads or GUI extension installation were performed during the archive work, and the currently installed `extension.wasm` was not overwritten. The user previously confirmed hover and extraction with the local server. New installer unit tests and a native probe exercised checksums, production Rust extraction, cache reuse and the packaged server; they do not prove Zed host calls or real GitHub downloading until the first public release is tested.

## Project-path safety limitation

For this first version, extraction and rename reject symlink/path-alias workspace roots or open documents rather than risking edits that bypass an unsaved catalog buffer. Reopen using the canonical real path shown in the error. This restriction is deliberate; transparent alias support is not implemented.

## API references checked

The implementation was checked against the published **0.7.0** crate's `src/extension_api.rs`, `src/settings.rs`, `wit/since_v0.2.0/settings.rs`, and `wit/since_v0.6.0/extension.wit`, rather than inferring signatures from an unrelated extension. In particular, it uses `Extension::language_server_command`, `LspSettings::for_worktree`, `CommandSettings` and `register_extension!`.

Official upstream references (repository paths):

- `zed-industries/zed`: `crates/extension/src/extension_manifest.rs` — schema 1, optional authors, language-server names and language-ID mapping.
- `zed-industries/zed`: `docs/src/extensions/developing-extensions.md` — local dev extension installation and WASI Preview 2 target.
- `zed-industries/zed`: `docs/src/configuring-languages.md` — binary path/arguments/env and array replacement/exclusion behavior.
- `zed-industries/zed`: `crates/grammars/src/{typescript,tsx,javascript}/config.toml` — built-in language names and JSX classification.
- `zed-industries/zed`: `crates/extension_api/README.md` — API compatibility caveat.
