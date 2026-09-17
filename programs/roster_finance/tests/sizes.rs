//! Prints measured account sizes and rent for docs/RENT.md.
use anchor_lang::Space;
use roster_finance::state::*;

#[test]
fn print_sizes() {
    let series = 8 + core::mem::size_of::<Series>();
    let market = 8 + MarketConfig::INIT_SPACE;
    let protocol = 8 + Protocol::INIT_SPACE;
    let rent = |bytes: usize| (bytes as f64 + 128.0) * 6960.0 / 1e9; // lamports per byte-year x 2 years exemption, in SOL
    println!("SIZES series={series} market={market} protocol={protocol} ask={} writer={}", core::mem::size_of::<Ask>(), core::mem::size_of::<WriterSlot>());
    println!("RENT_SOL series={:.4} market={:.4} protocol={:.4}", rent(series), rent(market), rent(protocol));
}
