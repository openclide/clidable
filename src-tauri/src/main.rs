// Prevent a console window from popping up alongside the GUI on Windows
// release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    clidable_lib::run();
}
