// Temporary console subsystem while diagnosing Windows startup.

#[cfg_attr(not(windows), allow(dead_code))]
mod logic;

#[cfg(windows)]
mod windows_app;

#[cfg(windows)]
fn main() {
    if let Err(error) = windows_app::run() {
        windows_app::show_fatal_error(&error);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("AIGC-Proof Desktop Preview is packaged for Windows x64.");
}
