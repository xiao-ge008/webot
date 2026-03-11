#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    webot_service_rs::init_tracing();
    webot_service_rs::run_from_env().await
}
