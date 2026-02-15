use std::process::Command;

fn main() {
    // Run make in the project root directory before building
    println!("cargo:rerun-if-changed=../Makefile");
    println!("cargo:rerun-if-changed=../src");

    let output = Command::new("make")
        .current_dir("..")
        .output()
        .expect("Failed to execute make command");

    if !output.status.success() {
        panic!(
            "make command failed with exit code: {}\nstdout: {}\nstderr: {}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    println!("make completed successfully");

    tauri_build::build()
}
