//! Opening a board page in the computer's web browser.
//!
//! An automatic server opens its project's board once after it starts, and
//! `agboard open` opens one on request. Neither opens anything with
//! `AGBOARD_OPEN_BROWSER=0`, or where no browser can be shown (an SSH session,
//! or Linux without a display). `AGBOARD_BROWSER_OPENER` names a program that
//! is started instead of the system's, with the address as its only argument;
//! the tests use it to record the address. Only the real command line opens
//! anything: the library embedded in a test never does.

use std::ffi::OsString;
use std::process::{Command, Stdio};

use crate::domain::ProjectId;

/// The operating systems whose opener Agent Board can start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Platform {
    MacOs,
    Windows,
    Other,
}

impl Platform {
    pub(crate) const CURRENT: Platform = if cfg!(target_os = "macos") {
        Platform::MacOs
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Other
    };

    /// The program that opens a folder, a file, or an address in the app the
    /// computer uses for it.
    pub(crate) fn opener(self) -> &'static str {
        match self {
            Platform::MacOs => "open",
            Platform::Windows => "explorer",
            Platform::Other => "xdg-open",
        }
    }
}

/// The address of a project's board on the server at `port`.
pub fn board_url(port: u16, project: &ProjectId) -> String {
    format!("http://127.0.0.1:{port}/?project={project}")
}

/// Why no browser is opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotOpened {
    /// `AGBOARD_OPEN_BROWSER=0`.
    TurnedOff,
    /// The command runs in an SSH session, whose browser is elsewhere.
    Ssh,
    /// Linux or another system without `DISPLAY` or `WAYLAND_DISPLAY`.
    NoDisplay,
    /// The library embedded in a program other than `agboard`.
    NotCommandLine,
}

impl NotOpened {
    /// The reason as a sentence for people.
    pub fn reason(self) -> &'static str {
        match self {
            NotOpened::TurnedOff => "AGBOARD_OPEN_BROWSER=0 turns opening the browser off.",
            NotOpened::Ssh => "This is an SSH session, so the browser is on another computer.",
            NotOpened::NoDisplay => {
                "No display is available (DISPLAY and WAYLAND_DISPLAY are unset)."
            }
            NotOpened::NotCommandLine => "Only the agboard command opens a browser.",
        }
    }
}

/// The program that opens an address, decided once from the environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opener {
    program: OsString,
}

/// The opener for this process, or why there is none. `env` reads a variable.
pub fn opener(env: &dyn Fn(&str) -> Option<String>) -> Result<Opener, NotOpened> {
    if !crate::autostart::in_command_line() {
        return Err(NotOpened::NotCommandLine);
    }
    opener_for(Platform::CURRENT, env)
}

fn opener_for(
    platform: Platform,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Opener, NotOpened> {
    let set = |name: &str| env(name).is_some_and(|value| !value.trim().is_empty());
    if env("AGBOARD_OPEN_BROWSER").is_some_and(|value| value.trim() == "0") {
        return Err(NotOpened::TurnedOff);
    }
    // A program of the user's own decides for itself where it shows the page.
    if let Some(program) = env("AGBOARD_BROWSER_OPENER").filter(|value| !value.trim().is_empty()) {
        return Ok(Opener {
            program: program.into(),
        });
    }
    if set("SSH_CONNECTION") || set("SSH_TTY") {
        return Err(NotOpened::Ssh);
    }
    if platform == Platform::Other && !set("DISPLAY") && !set("WAYLAND_DISPLAY") {
        return Err(NotOpened::NoDisplay);
    }
    Ok(Opener {
        program: platform.opener().into(),
    })
}

impl Opener {
    /// Start the opener on `url` without waiting for it to finish. The address
    /// is one argument of its own and never goes through a shell.
    pub fn open(&self, url: &str) -> Result<(), String> {
        let mut child = Command::new(&self.program)
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                format!("Cannot start {}: {error}.", self.program.to_string_lossy())
            })?;
        // Reap the process in the background so it does not stay a zombie.
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_of(vars: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| {
            vars.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        }
    }

    fn program(opener: Result<Opener, NotOpened>) -> Result<String, NotOpened> {
        opener.map(|opener| opener.program.to_string_lossy().into_owned())
    }

    #[test]
    fn each_platform_has_its_own_opener() {
        assert_eq!(Platform::MacOs.opener(), "open");
        assert_eq!(Platform::Windows.opener(), "explorer");
        assert_eq!(Platform::Other.opener(), "xdg-open");
        let none = env_of(&[]);
        assert_eq!(
            program(opener_for(Platform::MacOs, &none)),
            Ok("open".into())
        );
        let x11 = env_of(&[("DISPLAY", ":0")]);
        assert_eq!(
            program(opener_for(Platform::Other, &x11)),
            Ok("xdg-open".into())
        );
        let wayland = env_of(&[("WAYLAND_DISPLAY", "wayland-0")]);
        assert!(opener_for(Platform::Other, &wayland).is_ok());
    }

    #[test]
    fn nothing_opens_when_turned_off_over_ssh_or_without_a_display() {
        let off = env_of(&[
            ("AGBOARD_OPEN_BROWSER", "0"),
            ("AGBOARD_BROWSER_OPENER", "x"),
        ]);
        assert_eq!(opener_for(Platform::MacOs, &off), Err(NotOpened::TurnedOff));
        let ssh = env_of(&[("SSH_CONNECTION", "10.0.0.2 51000 10.0.0.1 22")]);
        assert_eq!(opener_for(Platform::MacOs, &ssh), Err(NotOpened::Ssh));
        let tty = env_of(&[("SSH_TTY", "/dev/ttys001"), ("DISPLAY", ":0")]);
        assert_eq!(opener_for(Platform::Other, &tty), Err(NotOpened::Ssh));
        let headless = env_of(&[("DISPLAY", " ")]);
        assert_eq!(
            opener_for(Platform::Other, &headless),
            Err(NotOpened::NoDisplay)
        );
        // Any other value leaves opening on.
        let on = env_of(&[("AGBOARD_OPEN_BROWSER", "1")]);
        assert!(opener_for(Platform::MacOs, &on).is_ok());
    }

    #[test]
    fn a_program_of_ones_own_replaces_the_system_opener() {
        let own = env_of(&[
            ("AGBOARD_BROWSER_OPENER", "record-url"),
            ("SSH_TTY", "/dev/ttys001"),
        ]);
        assert_eq!(
            program(opener_for(Platform::Other, &own)),
            Ok("record-url".into())
        );
    }

    #[test]
    fn the_library_never_opens_a_browser() {
        assert_eq!(opener(&|_| None), Err(NotOpened::NotCommandLine));
    }

    #[test]
    fn the_board_address_names_the_project() {
        let project: ProjectId = "0123456789abcdef0123456789abcdef".parse().unwrap();
        assert_eq!(
            board_url(7420, &project),
            "http://127.0.0.1:7420/?project=0123456789abcdef0123456789abcdef"
        );
    }

    #[test]
    fn a_missing_program_is_reported() {
        let opener = Opener {
            program: "agboard-no-such-opener".into(),
        };
        let error = opener.open("http://127.0.0.1:1/").unwrap_err();
        assert!(
            error.starts_with("Cannot start agboard-no-such-opener:"),
            "{error}"
        );
    }
}
