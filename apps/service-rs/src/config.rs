use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

use crate::path_resolver;

#[derive(Clone)]
pub struct ServiceConfig {
    pub listen_addr: SocketAddr,
    pub openfang_base_url: String,
    pub openfang_api_key: Option<String>,
    pub request_timeout_ms: u64,
    pub openfang_auto_start: bool,
    pub openfang_start_command: Option<String>,
    pub openfang_start_args: Vec<String>,
    pub openfang_workdir: Option<PathBuf>,
    pub openfang_startup_wait_ms: u64,
}

impl ServiceConfig {
    pub fn from_env() -> Self {
        load_env_sources();

        let listen_addr = env::var("SERVICE_LISTEN_ADDR")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or_else(|| {
                "127.0.0.1:4310"
                    .parse()
                    .expect("default listen addr is valid")
            });

        let openfang_base_url =
            env::var("OPENFANG_BASE_URL").unwrap_or_else(|_| "http://127.0.0.1:4200".to_string());

        let openfang_api_key = env::var("OPENFANG_API_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let request_timeout_ms = env::var("OPENFANG_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(20_000);

        let openfang_auto_start = env::var("OPENFANG_AUTO_START")
            .ok()
            .map(|v| {
                matches!(
                    v.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(true);

        let openfang_start_command = env::var("OPENFANG_START_COMMAND")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        let openfang_start_args = env::var("OPENFANG_START_ARGS")
            .ok()
            .map(|v| {
                v.split_whitespace()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .filter(|args| !args.is_empty())
            .unwrap_or_else(|| vec!["start".to_string()]);

        let openfang_workdir = env::var("OPENFANG_WORKDIR")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .or_else(discover_openfang_workdir);

        let openfang_startup_wait_ms = env::var("OPENFANG_STARTUP_WAIT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60_000);

        Self {
            listen_addr,
            openfang_base_url,
            openfang_api_key,
            request_timeout_ms,
            openfang_auto_start,
            openfang_start_command,
            openfang_start_args,
            openfang_workdir,
            openfang_startup_wait_ms,
        }
    }
}

fn load_env_sources() {
    let _ = dotenvy::dotenv();

    let runtime_home = path_resolver::openfang_runtime_home_dir().ok();
    if let Some(home) = runtime_home.as_ref() {
        let webot_env = home.join(".env");
        if webot_env.is_file() {
            let _ = dotenvy::from_path_override(&webot_env);
        }
    }

    if let Ok(cwd) = env::current_dir() {
        for depth in 0..=4 {
            let mut candidate = cwd.clone();
            for _ in 0..depth {
                if !candidate.pop() {
                    break;
                }
            }
            let env_file = candidate.join(".env");
            if env_file.is_file() {
                let _ = dotenvy::from_path_override(&env_file);
            }
        }
    }
}

fn discover_openfang_workdir() -> Option<PathBuf> {
    let cwd = env::current_dir().ok()?;
    let binary_name = if cfg!(windows) {
        "openfang.exe"
    } else {
        "openfang"
    };

    for depth in 0..=4 {
        let mut candidate = cwd.clone();
        for _ in 0..depth {
            if !candidate.pop() {
                break;
            }
        }

        let resource_root = candidate
            .join("apps")
            .join("frontend")
            .join("src-tauri")
            .join("resources")
            .join("openfang");

        let direct = resource_root.join(binary_name);
        if direct.is_file() {
            return resource_root.canonicalize().ok().or(Some(resource_root));
        }

        let platform = if cfg!(windows) {
            "win"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        };
        let platform_root = resource_root.join(platform);
        if platform_root.join(binary_name).is_file() {
            return platform_root.canonicalize().ok().or(Some(platform_root));
        }
    }

    None
}
