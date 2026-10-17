use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
};

pub(crate) const VERSION: &str = env!("CARGO_PKG_VERSION");
pub(crate) const ENTRYPOINT: &str = "server/dist/main.js";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Release {
    pub os: &'static str,
    pub arch: &'static str,
}

impl Release {
    fn asset(&self) -> String {
        format!(
            "sherlock-language-server-v{VERSION}-{}-{}.tar.gz",
            self.os, self.arch
        )
    }
    fn url(&self) -> String {
        format!(
            "https://github.com/asecher/sherlock-zed/releases/download/v{VERSION}/{}",
            self.asset()
        )
    }
    fn cache_name(&self) -> String {
        format!("sherlock-v{VERSION}-{}-{}", self.os, self.arch)
    }
}

pub(crate) fn platform(
    os: zed_extension_api::Os,
    arch: zed_extension_api::Architecture,
) -> Result<Release, String> {
    use zed_extension_api::{Architecture::*, Os::*};
    let (os, arch) = match (os, arch) {
        (Mac, Aarch64) => ("darwin", "arm64"),
        (Mac, X8664) => ("darwin", "x64"),
        (Linux, Aarch64) => ("linux", "arm64"),
        (Linux, X8664) => ("linux", "x64"),
        (Windows, X8664) => ("win32", "x64"),
        _ => return Err("Sherlock has no pinned release for this platform; configure lsp.sherlock.binary.path for a local server".into()),
    };
    Ok(Release { os, arch })
}

pub(crate) fn validate_node(stdout: &[u8], linux: bool) -> Result<(), String> {
    #[derive(serde::Deserialize)]
    struct Runtime {
        version: String,
        glibc: String,
    }
    let runtime: Runtime = serde_json::from_slice(stdout)
        .map_err(|e| format!("Cannot inspect Zed Node runtime: {e}"))?;
    let major = runtime
        .version
        .strip_prefix('v')
        .and_then(|v| v.split('.').next())
        .and_then(|v| v.parse::<u32>().ok());
    if major.is_none_or(|v| v < 24) {
        return Err(format!("Sherlock requires Node 24+; Zed provided {}. Update Zed's Node runtime or configure lsp.sherlock.binary.path", runtime.version));
    }
    if linux && runtime.glibc.is_empty() {
        return Err("Sherlock Linux releases require GNU/glibc; musl or undetected libc is unsupported. Configure lsp.sherlock.binary.path for a local server".into());
    }
    Ok(())
}

fn verify_checksum(archive: &Path, sidecar: &Path, asset: &str) -> Result<(), String> {
    // This sidecar checks transfer integrity, not publisher authenticity: both
    // files come from the same pinned HTTPS GitHub release.
    let mut side = String::new();
    fs::File::open(sidecar)
        .map_err(|e| e.to_string())?
        .take(4097)
        .read_to_string(&mut side)
        .map_err(|e| e.to_string())?;
    let suffix = format!("  {asset}\n");
    let hash = side
        .strip_suffix(&suffix)
        .ok_or("Invalid SHA256 sidecar filename or format")?;
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid SHA256 digest".into());
    }
    let mut reader = fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    if format!("{:x}", digest.finalize()) != hash.to_ascii_lowercase() {
        return Err(format!(
            "SHA256 mismatch for {asset}; remove the failed download and retry"
        ));
    }
    Ok(())
}

fn extract(
    archive: &Path,
    destination: &Path,
    max_bytes: u64,
    max_files: usize,
) -> Result<(), String> {
    let run = || -> Result<(), String> {
        let file = fs::File::open(archive).map_err(|e| e.to_string())?;
        // Bound all decompressed bytes, including tar metadata, not only file contents.
        let limit = max_bytes
            .saturating_add((max_files as u64).saturating_mul(2048))
            .saturating_add(1024);
        let decoder = flate2::read::GzDecoder::new(file).take(limit);
        let mut tar = tar::Archive::new(decoder);
        let mut expanded = 0u64;
        for (count, entry) in tar.entries().map_err(|e| e.to_string())?.enumerate() {
            if count >= max_files {
                return Err("Archive exceeds entry limit".into());
            }
            let mut entry = entry.map_err(|e| e.to_string())?;
            let name = entry.path().map_err(|e| e.to_string())?.into_owned();
            let text = name.to_str().ok_or("Non-UTF8 archive path")?;
            if text.contains(['\\', ':'])
                || name.is_absolute()
                || name
                    .components()
                    .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
            {
                return Err(format!("Unsafe archive path: {}", name.display()));
            }
            let kind = entry.header().entry_type();
            if !kind.is_file() && !kind.is_dir() {
                return Err(format!(
                    "Unsupported archive entry (links/devices forbidden): {}",
                    name.display()
                ));
            }
            let size = entry.size();
            expanded = expanded.checked_add(size).ok_or("Archive size overflow")?;
            if expanded > max_bytes {
                return Err("Archive exceeds expanded byte limit".into());
            }
            let target = destination.join(&name);
            if kind.is_dir() {
                fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                // create_new also rejects duplicate files and file/directory conflicts.
                let mut output = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&target)
                    .map_err(|e| e.to_string())?;
                let copied = io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
                if copied != size {
                    return Err("Truncated tar entry".into());
                }
                output.flush().map_err(|e| e.to_string())?;
            }
        }
        let mut decoder = tar.into_inner();
        io::copy(&mut decoder, &mut io::sink()).map_err(|e| e.to_string())?;
        if decoder.limit() == 0 {
            return Err("Archive exceeds decompression budget".into());
        }
        Ok(())
    };
    run().map_err(|e| format!("Cannot safely extract {}: {e}", archive.display()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: u32,
    name: String,
    version: String,
    os: String,
    arch: String,
    node_major: u32,
    entrypoint: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Completion {
    release: String,
    entrypoint_sha256: String,
}

fn regular_path(root: &Path, relative: &str, directory: bool) -> Result<PathBuf, String> {
    if !fs::symlink_metadata(root)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_dir()
    {
        return Err("Cache root is not a real directory".into());
    }
    let mut path = root.to_path_buf();
    let parts: Vec<_> = Path::new(relative).components().collect();
    for (index, part) in parts.iter().enumerate() {
        path.push(part);
        let kind = fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .file_type();
        let want_dir = index + 1 < parts.len() || directory;
        if (want_dir && !kind.is_dir()) || (!want_dir && !kind.is_file()) {
            return Err(format!("Invalid cache entry {}", path.display()));
        }
    }
    Ok(path)
}

fn small_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 64 * 1024 {
        return Err(format!("Oversized metadata {}", path.display()));
    }
    serde_json::from_reader(file).map_err(|e| e.to_string())
}

fn entrypoint_hash(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() == 0 {
        return Err("Empty server entrypoint".into());
    }
    let mut hash = Sha256::new();
    io::copy(&mut file, &mut hash).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hash.finalize()))
}

fn remove_path(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    }
    .map_err(|e| format!("Cannot remove {}: {e}", path.display()))
}

impl Release {
    fn validate_payload(&self, path: &Path) -> Result<String, String> {
        let manifest_path = regular_path(path, "release.json", false)?;
        let manifest: Manifest =
            small_json(&manifest_path).map_err(|e| format!("Invalid release manifest: {e}"))?;
        if manifest.format != 1
            || manifest.name != "sherlock-language-server"
            || manifest.version != VERSION
            || manifest.os != self.os
            || manifest.arch != self.arch
            || manifest.node_major != 24
            || manifest.entrypoint != ENTRYPOINT
        {
            return Err(format!(
                "Release manifest does not match pinned v{VERSION} {} {}",
                self.os, self.arch
            ));
        }
        let package: serde_json::Value = small_json(&regular_path(path, "package.json", false)?)?;
        if package.get("type").and_then(|v| v.as_str()) != Some("module") {
            return Err("Release package.json must declare type module".into());
        }
        regular_path(path, "node_modules", true)?;
        entrypoint_hash(&regular_path(path, ENTRYPOINT, false)?)
    }

    fn valid_cache(&self, path: &Path) -> bool {
        let validate = || -> Result<bool, String> {
            let hash = self.validate_payload(path)?;
            let complete: Completion = small_json(&regular_path(path, ".complete.json", false)?)?;
            Ok(complete.release == self.cache_name() && complete.entrypoint_sha256 == hash)
        };
        validate().unwrap_or(false)
    }

    pub(crate) fn install(
        &self,
        root: &Path,
        mut download: impl FnMut(&str, &Path) -> Result<(), String>,
    ) -> Result<PathBuf, String> {
        let cache = root.join(self.cache_name());
        if self.valid_cache(&cache) {
            return Ok(cache);
        }
        let staging = root.join(format!("{}.staging", self.cache_name()));
        let install = || -> Result<PathBuf, String> {
            remove_path(&staging)?;
            fs::create_dir(&staging).map_err(|e| e.to_string())?;
            let archive = staging.join(self.asset());
            let sidecar = staging.join(format!("{}.sha256", self.asset()));
            download(&self.url(), &archive)?;
            download(&format!("{}.sha256", self.url()), &sidecar)?;
            verify_checksum(&archive, &sidecar, &self.asset())?;
            let payload = staging.join("payload");
            fs::create_dir(&payload).map_err(|e| e.to_string())?;
            extract(&archive, &payload, 1024 * 1024 * 1024, 50_000)?;
            let hash = self.validate_payload(&payload)?;
            let complete = Completion {
                release: self.cache_name(),
                entrypoint_sha256: hash,
            };
            let marker = serde_json::to_vec(&complete).map_err(|e| e.to_string())?;
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(payload.join(".complete.json"))
                .map_err(|e| e.to_string())?;
            file.write_all(&marker).map_err(|e| e.to_string())?;
            drop(file);
            remove_path(&cache)?;
            // Payload and cache share the extension filesystem: promotion is atomic.
            fs::rename(&payload, &cache).map_err(|e| e.to_string())?;
            Ok(cache.clone())
        };
        let mut install = install;
        let result = install();
        let cleanup = remove_path(&staging);
        match result {
            Ok(path) => { cleanup?; Ok(path) },
            Err(error) => Err(format!("Sherlock pinned v{VERSION} installation failed ({}): {error}. Retry to download again, or configure lsp.sherlock.binary.path for a local server", self.url())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zed_extension_api::{Architecture::*, Os::*};

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let root =
                PathBuf::from(std::env::var_os("HOME").unwrap()).join(".hermes/cache/scratch");
            fs::create_dir_all(&root).unwrap();
            let path = root.join(format!(
                "sherlock-rust-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn archive(path: &Path, entries: &[(&str, tar::EntryType, &[u8])]) {
        let encoder = flate2::write::GzEncoder::new(
            fs::File::create(path).unwrap(),
            flate2::Compression::default(),
        );
        let mut builder = tar::Builder::new(encoder);
        for (name, kind, data) in entries {
            let mut header = tar::Header::new_gnu();
            // Raw names intentionally allow malicious traversal fixtures.
            header.as_mut_bytes()[..name.len()].copy_from_slice(name.as_bytes());
            header.set_entry_type(*kind);
            header.set_mode(0o755);
            header.set_size(data.len() as u64);
            if kind.is_symlink() || kind.is_hard_link() {
                header.set_link_name("outside").unwrap();
            }
            header.set_cksum();
            builder.append(&header, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();
    }

    fn release_archive(path: &Path, version: &str) {
        let manifest = format!(
            r#"{{"format":1,"name":"sherlock-language-server","version":"{version}","os":"darwin","arch":"arm64","nodeMajor":24,"entrypoint":"server/dist/main.js"}}"#
        );
        archive(
            path,
            &[
                ("release.json", tar::EntryType::Regular, manifest.as_bytes()),
                (
                    "package.json",
                    tar::EntryType::Regular,
                    br#"{"type":"module"}"#,
                ),
                (
                    ENTRYPOINT,
                    tar::EntryType::Regular,
                    b"console.log('server')",
                ),
                (
                    "node_modules/dependency/index.js",
                    tar::EntryType::Regular,
                    b"export {}",
                ),
            ],
        );
    }

    fn fixture_download<'a>(
        source: &'a Path,
        release: &'a Release,
        calls: &'a mut Vec<String>,
    ) -> impl FnMut(&str, &Path) -> Result<(), String> + 'a {
        move |url, destination| {
            calls.push(url.into());
            if url == format!("{}.sha256", release.url()) {
                fs::write(
                    destination,
                    format!(
                        "{:x}  {}\n",
                        Sha256::digest(fs::read(source).unwrap()),
                        release.asset()
                    ),
                )
                .map_err(|e| e.to_string())?;
            } else {
                assert_eq!(url, release.url());
                fs::copy(source, destination).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
    }

    #[test]
    fn install_promotes_validated_payload_and_reuses_without_network() {
        let s = Scratch::new();
        let source = s.0.join("fixture.tar.gz");
        release_archive(&source, VERSION);
        let release = Release {
            os: "darwin",
            arch: "arm64",
        };
        let mut calls = vec![];
        let installed = release
            .install(&s.0, fixture_download(&source, &release, &mut calls))
            .unwrap();
        assert_eq!(calls, [release.url(), format!("{}.sha256", release.url())]);
        assert!(release.valid_cache(&installed));
        assert_eq!(installed, s.0.join(release.cache_name()));
        assert!(!s
            .0
            .join(format!("{}.staging", release.cache_name()))
            .exists());
        assert_eq!(
            release
                .install(&s.0, |_, _| panic!("network used for valid cache"))
                .unwrap(),
            installed
        );
    }

    #[test]
    fn corrupt_and_incomplete_caches_are_recovered() {
        let s = Scratch::new();
        let source = s.0.join("fixture.tar.gz");
        release_archive(&source, VERSION);
        let release = Release {
            os: "darwin",
            arch: "arm64",
        };
        let mut calls = vec![];
        let installed = release
            .install(&s.0, fixture_download(&source, &release, &mut calls))
            .unwrap();
        for file in [".complete.json", "release.json", ENTRYPOINT, "package.json"] {
            fs::write(installed.join(file), b"corrupt").unwrap();
            assert!(!release.valid_cache(&installed), "accepted corrupt {file}");
            calls.clear();
            release
                .install(&s.0, fixture_download(&source, &release, &mut calls))
                .unwrap();
            assert_eq!(calls.len(), 2);
        }
        fs::remove_file(installed.join(ENTRYPOINT)).unwrap();
        assert!(!release.valid_cache(&installed));
        release
            .install(&s.0, fixture_download(&source, &release, &mut calls))
            .unwrap();
        assert!(release.valid_cache(&installed));
        let other = Release {
            os: "linux",
            arch: "x64",
        };
        assert!(!other.valid_cache(&installed));
    }

    #[test]
    fn failed_download_checksum_or_manifest_never_completes_and_can_retry() {
        let s = Scratch::new();
        let source = s.0.join("fixture.tar.gz");
        release_archive(&source, "99.0.0");
        let release = Release {
            os: "darwin",
            arch: "arm64",
        };
        let mut calls = vec![];
        let error = release
            .install(&s.0, |_, _| Err("release unavailable".into()))
            .unwrap_err();
        assert!(error.contains("release unavailable"));
        assert!(error.contains("v0.1.0"));
        assert!(!s.0.join(release.cache_name()).exists());
        assert!(release
            .install(&s.0, fixture_download(&source, &release, &mut calls))
            .unwrap_err()
            .contains("manifest"));
        assert!(!s.0.join(release.cache_name()).exists());
        assert!(!s
            .0
            .join(format!("{}.staging", release.cache_name()))
            .exists());
        release_archive(&source, VERSION);
        assert!(release
            .install(&s.0, |url, destination| {
                if url.ends_with(".sha256") {
                    fs::write(
                        destination,
                        format!("{}  {}\n", "0".repeat(64), release.asset()),
                    )
                    .unwrap();
                } else {
                    fs::copy(&source, destination).unwrap();
                }
                Ok(())
            })
            .unwrap_err()
            .contains("SHA256 mismatch"));
        assert!(!s.0.join(release.cache_name()).exists());
        let installed = release
            .install(&s.0, fixture_download(&source, &release, &mut calls))
            .unwrap();
        assert!(release.valid_cache(&installed));
    }

    #[test]
    fn cache_manifest_fields_and_required_files_are_validated() {
        let s = Scratch::new();
        let source = s.0.join("fixture.tar.gz");
        release_archive(&source, VERSION);
        let release = Release {
            os: "darwin",
            arch: "arm64",
        };
        let mut calls = vec![];
        let installed = release
            .install(&s.0, fixture_download(&source, &release, &mut calls))
            .unwrap();
        let manifest_path = installed.join("release.json");
        let original = fs::read(&manifest_path).unwrap();
        for (key, value) in [
            ("format", serde_json::json!(2)),
            ("name", serde_json::json!("wrong")),
            ("version", serde_json::json!("99.0.0")),
            ("os", serde_json::json!("linux")),
            ("arch", serde_json::json!("x64")),
            ("nodeMajor", serde_json::json!(22)),
            ("entrypoint", serde_json::json!("../outside.js")),
        ] {
            let mut manifest: serde_json::Value = serde_json::from_slice(&original).unwrap();
            manifest[key] = value;
            fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
            assert!(
                !release.valid_cache(&installed),
                "accepted wrong manifest {key}"
            );
        }
        fs::write(&manifest_path, original).unwrap();
        fs::remove_dir_all(installed.join("node_modules")).unwrap();
        assert!(!release.valid_cache(&installed));
    }

    #[cfg(unix)]
    #[test]
    fn cache_symlinks_are_not_trusted_and_are_replaced_safely() {
        let s = Scratch::new();
        let source = s.0.join("fixture.tar.gz");
        release_archive(&source, VERSION);
        let release = Release {
            os: "darwin",
            arch: "arm64",
        };
        let mut calls = vec![];
        let installed = release
            .install(&s.0, fixture_download(&source, &release, &mut calls))
            .unwrap();
        let outside = s.0.join("outside");
        fs::rename(&installed, &outside).unwrap();
        std::os::unix::fs::symlink(&outside, &installed).unwrap();
        assert!(!release.valid_cache(&installed));
        release
            .install(&s.0, fixture_download(&source, &release, &mut calls))
            .unwrap();
        assert!(release.valid_cache(&installed));
        assert!(outside.join(ENTRYPOINT).is_file());
        fs::remove_dir_all(installed.join("server")).unwrap();
        std::os::unix::fs::symlink(outside.join("server"), installed.join("server")).unwrap();
        assert!(!release.valid_cache(&installed));
    }

    #[test]
    fn stale_staging_is_removed_before_retry() {
        let s = Scratch::new();
        let source = s.0.join("fixture.tar.gz");
        release_archive(&source, VERSION);
        let release = Release {
            os: "darwin",
            arch: "arm64",
        };
        let staging = s.0.join(format!("{}.staging", release.cache_name()));
        fs::create_dir_all(staging.join("payload")).unwrap();
        fs::write(staging.join("payload/unfinished"), b"incomplete").unwrap();
        let mut calls = vec![];
        let installed = release
            .install(&s.0, fixture_download(&source, &release, &mut calls))
            .unwrap();
        assert!(release.valid_cache(&installed));
        assert!(!installed.join("unfinished").exists());
        assert!(!staging.exists());
    }

    #[test]
    fn checksum_checks_content_and_exact_asset_sidecar() {
        let s = Scratch::new();
        let file = s.0.join("archive");
        let side = s.0.join("checksum");
        fs::write(&file, b"abc").unwrap();
        let hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        fs::write(&side, format!("{hash}  asset.tar.gz\n")).unwrap();
        verify_checksum(&file, &side, "asset.tar.gz").unwrap();
        assert!(verify_checksum(&file, &side, "other.tar.gz").is_err());
        fs::write(&file, b"corrupt").unwrap();
        assert!(verify_checksum(&file, &side, "asset.tar.gz").is_err());
        fs::write(&side, "not-a-checksum").unwrap();
        assert!(verify_checksum(&file, &side, "asset.tar.gz").is_err());
    }

    #[test]
    fn extraction_allows_normal_files_but_rejects_links_and_unsafe_paths() {
        let s = Scratch::new();
        let file = s.0.join("archive");
        let out = s.0.join("out");
        fs::create_dir(&out).unwrap();
        archive(
            &file,
            &[(ENTRYPOINT, tar::EntryType::Regular, b"console.log('hi')")],
        );
        extract(&file, &out, 1024, 10).unwrap();
        assert_eq!(
            fs::read(out.join(ENTRYPOINT)).unwrap(),
            b"console.log('hi')"
        );
        for (name, kind) in [
            ("../escape", tar::EntryType::Regular),
            ("/absolute", tar::EntryType::Regular),
            ("C:/windows", tar::EntryType::Regular),
            ("..\\escape", tar::EntryType::Regular),
            ("link", tar::EntryType::Symlink),
            ("hard", tar::EntryType::Link),
            ("device", tar::EntryType::Char),
        ] {
            archive(&file, &[(name, kind, b"")]);
            assert!(extract(&file, &out, 1024, 10).is_err(), "accepted {name}");
        }
        assert!(!s.0.join("escape").exists());
    }

    #[test]
    fn extraction_enforces_expansion_and_entry_limits() {
        let s = Scratch::new();
        let file = s.0.join("archive");
        let out = s.0.join("out");
        fs::create_dir(&out).unwrap();
        archive(
            &file,
            &[
                ("one", tar::EntryType::Regular, b"1234"),
                ("two", tar::EntryType::Regular, b"5678"),
            ],
        );
        assert!(extract(&file, &out, 7, 10).is_err());
        fs::remove_dir_all(&out).unwrap();
        fs::create_dir(&out).unwrap();
        assert!(extract(&file, &out, 1024, 1).is_err());
        fs::write(&file, b"not gzip").unwrap();
        assert!(extract(&file, &out, 1024, 10).is_err());
    }

    #[test]
    fn platform_mapping_rejects_unbuilt_targets() {
        for (os, arch, expected_os, expected_arch) in [
            (Mac, Aarch64, "darwin", "arm64"),
            (Mac, X8664, "darwin", "x64"),
            (Linux, Aarch64, "linux", "arm64"),
            (Linux, X8664, "linux", "x64"),
            (Windows, X8664, "win32", "x64"),
        ] {
            assert_eq!(
                platform(os, arch).unwrap(),
                Release {
                    os: expected_os,
                    arch: expected_arch
                }
            );
        }
        assert!(platform(Windows, Aarch64).is_err());
        assert!(platform(Linux, X86).is_err());
    }

    #[test]
    fn node_requires_24_or_newer_and_linux_glibc() {
        assert!(validate_node(br#"{"version":"v24.3.0","glibc":"2.39"}"#, true).is_ok());
        assert!(validate_node(br#"{"version":"v25.0.0","glibc":""}"#, false).is_ok());
        assert!(validate_node(br#"{"version":"v22.0.0","glibc":"2.39"}"#, true).is_err());
        assert!(validate_node(br#"{"version":"v24.3.0","glibc":""}"#, true)
            .unwrap_err()
            .contains("glibc"));
        assert!(validate_node(b"garbage", false).is_err());
    }

    #[test]
    fn release_urls_and_cache_are_pinned_to_package_version_and_platform() {
        let r = Release {
            os: "darwin",
            arch: "arm64",
        };
        assert_eq!(
            r.asset(),
            "sherlock-language-server-v0.1.0-darwin-arm64.tar.gz"
        );
        assert_eq!(r.url(), "https://github.com/asecher/sherlock-zed/releases/download/v0.1.0/sherlock-language-server-v0.1.0-darwin-arm64.tar.gz");
        assert_eq!(r.cache_name(), "sherlock-v0.1.0-darwin-arm64");
    }
}
