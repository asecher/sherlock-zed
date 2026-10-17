mod release;

use zed_extension_api::{self as zed, settings::CommandSettings};

const LOCAL_CONFIGURATION: &str = "Configure lsp.sherlock.binary.path as the absolute Node 24+ executable path and binary.arguments as [\"/absolute/path/to/sherlock-zed/server/dist/main.js\", \"--stdio\"]. Build the local server first; Sherlock does not download an npm package.";

fn configured_command(binary: Option<CommandSettings>) -> zed::Result<zed::Command> {
    let binary = binary.ok_or_else(|| LOCAL_CONFIGURATION.to_string())?;
    let command = binary
        .path
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| LOCAL_CONFIGURATION.to_string())?;
    Ok(zed::Command {
        command,
        args: binary.arguments.unwrap_or_default(),
        env: binary.env.unwrap_or_default().into_iter().collect(),
    })
}

fn select_command(
    binary: Option<CommandSettings>,
    automatic: impl FnOnce() -> zed::Result<zed::Command>,
) -> zed::Result<zed::Command> {
    match binary {
        Some(binary) => configured_command(Some(binary)),
        None => automatic(),
    }
}

fn automatic_command(node: String, installation: &std::path::Path) -> zed::Result<zed::Command> {
    let entrypoint = installation
        .join(release::ENTRYPOINT)
        .to_str()
        .ok_or("Sherlock install path is not UTF-8")?
        .to_owned();
    Ok(zed::Command {
        command: node,
        args: vec![entrypoint, "--stdio".into()],
        env: vec![],
    })
}

fn install_and_command() -> zed::Result<zed::Command> {
    let (os, arch) = zed::current_platform();
    let release = release::platform(os, arch)?;
    let node = zed::node_binary_path()
        .map_err(|e| format!("Sherlock could not obtain Zed's Node 24+ runtime: {e}"))?;
    let output = zed::process::Command::new(&node)
        .args(["-p", "JSON.stringify({version:process.version,glibc:process.report?.getReport().header.glibcVersionRuntime||''})"])
        .output().map_err(|e| format!("Sherlock could not inspect Zed's Node runtime: {e}"))?;
    if output.status != Some(0) {
        return Err(format!(
            "Sherlock Node runtime check failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    release::validate_node(&output.stdout, release.os == "linux")?;
    let root = std::env::current_dir()
        .map_err(|e| format!("Cannot locate Sherlock extension work directory: {e}"))?;
    let installation = release.install(&root, |url, destination| {
        // download_file accepts a path within the extension work directory.
        let relative = destination.strip_prefix(&root).map_err(|e| e.to_string())?;
        let path = relative
            .to_str()
            .ok_or("Sherlock download path is not UTF-8")?;
        zed::download_file(url, path, zed::DownloadedFileType::Uncompressed)
            .map_err(|e| format!("Download {url} failed: {e}"))
    })?;
    automatic_command(node, &installation)
}

struct SherlockExtension;

impl zed::Extension for SherlockExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let settings =
            zed::settings::LspSettings::for_worktree(language_server_id.as_ref(), worktree)?;
        select_command(settings.binary, install_and_command)
    }
}

zed::register_extension!(SherlockExtension);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_settings_launches_pinned_entrypoint_with_stdio() {
        let command = select_command(None, || {
            automatic_command(
                "/Zed Node/node".into(),
                std::path::Path::new("/extension with spaces/sherlock-v0.1.0-darwin-arm64"),
            )
        })
        .unwrap();
        assert_eq!(command.command, "/Zed Node/node");
        assert_eq!(
            command.args,
            [
                "/extension with spaces/sherlock-v0.1.0-darwin-arm64/server/dist/main.js",
                "--stdio"
            ]
        );
        assert!(command.env.is_empty());
    }

    #[test]
    fn binary_override_bypasses_all_automatic_install_and_runtime_work() {
        let command = select_command(
            Some(CommandSettings {
                path: Some(" custom node ".into()),
                arguments: Some(vec!["custom.js".into()]),
                env: None,
            }),
            || panic!("automatic installer called for override"),
        )
        .unwrap();
        assert_eq!(command.command, " custom node ");
        assert_eq!(command.args, ["custom.js"]);
    }

    #[test]
    fn explicit_node_launch_preserves_arguments_and_environment() {
        let command = configured_command(Some(CommandSettings {
            path: Some("/opt/node/bin/node".into()),
            arguments: Some(vec![
                "/projects/with spaces/server/dist/main.js".into(),
                "--stdio".into(),
            ]),
            env: Some(std::collections::HashMap::from([(
                "SHERLOCK_TEST".into(),
                "yes".into(),
            )])),
        }))
        .unwrap();
        assert_eq!(command.command, "/opt/node/bin/node");
        assert_eq!(
            command.args,
            ["/projects/with spaces/server/dist/main.js", "--stdio"]
        );
        assert_eq!(command.env, [("SHERLOCK_TEST".into(), "yes".into())]);
    }

    #[test]
    fn blank_binary_path_is_rejected_with_setup_help() {
        for path in [None, Some(String::new()), Some("   ".into())] {
            let result = configured_command(Some(CommandSettings {
                path,
                arguments: None,
                env: None,
            }));
            assert!(result.unwrap_err().contains("lsp.sherlock.binary.path"));
        }
    }

    #[test]
    fn missing_binary_explains_local_launch_configuration() {
        let error = configured_command(None).unwrap_err();
        assert!(error.contains("lsp.sherlock.binary.path"));
        assert!(error.contains("arguments"));
        assert!(error.contains("--stdio"));
    }
}
