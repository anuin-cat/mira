fn main() {
    println!("cargo:rerun-if-changed=../src/features/commands/appCommandManifest.json");
    tauri_build::build()
}
