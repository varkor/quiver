use clap::Parser;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::OnceLock;

static CLI_ARGS: OnceLock<ProcessedArgs> = OnceLock::new();

#[derive(Parser, Debug, Clone, Serialize, Deserialize)]
#[command(name = "quiver")]
#[command(about = "A modern commutative diagram editor", long_about = None)]
pub struct Args {
    #[arg(
        long = "output-file",
        help = "Path to file where tikzcd code should be written on exit.
Inclusion of this parameter also alters behaviour of save button.
Instead of just saving your diagram it will also close application and write to the output file."
    )]
    pub output_file: Option<String>,

    #[arg(
        long,
        help = "Path to a file or URL containing LaTeX macro definitions."
    )]
    pub macros: Option<String>,

    #[arg(help = "Base64 encoded diagram data to load on startup.")]
    pub data: Option<String>,
}

// Processed args with file content instead of paths
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessedArgs {
    pub output_file: Option<String>,
    pub macro_content: Option<String>,
    pub data: Option<String>,
}

#[tauri::command]
fn get_cli_args() -> ProcessedArgs {
    CLI_ARGS
        .get()
        .unwrap_or(&ProcessedArgs {
            output_file: None,
            macro_content: None,
            data: None,
        })
        .clone()
}

#[tauri::command]
fn console_log(message: String) {
    println!("[FRONTEND] {message}");
}

#[tauri::command]
fn console_error(message: String) {
    eprintln!("[FRONTEND ERROR] {message}");
}

#[tauri::command]
async fn close_app(app: tauri::AppHandle, data: Option<String>) -> Result<(), String> {
    // Write output file if diagram was saved and output file specified
    let args = CLI_ARGS.get().ok_or("CLI args not initialized")?;

    if let (Some(output_file), Some(code)) = (&args.output_file, &data) {
        match std::fs::write(output_file, code) {
            Ok(()) => {
                println!("Successfully wrote output to: {output_file}");
            }
            Err(e) => {
                let error_msg = format!("Failed to write to '{output_file}': {e}");
                eprintln!("{error_msg}");
                eprintln!("Content that failed to write:");
                eprintln!("{code}");
                return Err(error_msg);
            }
        }
    }

    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn close_app_no_output(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args = Args::parse();

    // Process macro file content if provided
    let macro_content = if let Some(macro_path) = &args.macros {
        if macro_path.starts_with("http://") || macro_path.starts_with("https://") {
            // For URLs, pass the URL as-is (will be handled by frontend)
            Some(macro_path.clone())
        } else {
            // For file paths, read the content now
            let path = Path::new(macro_path);
            let absolute_path = match path.canonicalize() {
                Ok(path) => path,
                Err(e) => {
                    eprintln!("Error: Could not find macro file '{macro_path}': {e}");
                    std::process::exit(1);
                }
            };

            match std::fs::read_to_string(&absolute_path) {
                Ok(content) => {
                    println!("Loaded macro file: {}", absolute_path.display());
                    Some(content)
                }
                Err(e) => {
                    eprintln!(
                        "Error: Failed to read macro file '{}': {}",
                        absolute_path.display(),
                        e
                    );
                    std::process::exit(1);
                }
            }
        }
    } else {
        None
    };

    let processed_args = ProcessedArgs {
        output_file: args.output_file,
        macro_content,
        data: args.data,
    };

    CLI_ARGS.set(processed_args).unwrap();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_cli_args,
            console_log,
            console_error,
            close_app,
            close_app_no_output
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
