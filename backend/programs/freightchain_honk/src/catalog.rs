//! Cab pairs the program will sell. The buyer does not pass a price.
//! Defaults are absent on purpose: they, and anything unknown, are `NotForSale`.
//! Ids: `server/src/domain/honk/parts-catalog.ts` and `docs/spec/ten4.md`.
use anchor_lang::prelude::*;

use crate::{constants::*, error::HonkError};

/// `(slot, item, gold)`. Gold is `260 * UNIT`. Every other row is `65 * UNIT`.
const LISTED: &[(&str, &str, bool)] = &[
    ("wheel", "crimson", false),
    ("wheel", "ocean", false),
    ("wheel", "moss", false),
    ("wheel", "gold", true),
    ("wheel", "ivory", false),
    ("truck_color", "blue", false),
    ("truck_color", "green", false),
    ("truck_color", "black", false),
    ("truck_color", "yellow", false),
    ("truck_color", "white", false),
    ("gearbox", "chrome", false),
    ("gearbox", "wood", false),
    ("gearbox", "racing", false),
    ("gearbox", "gold", true),
    ("gearbox", "carbon", false),
    ("dice", "red", false),
    ("dice", "blue", false),
    ("dice", "gold", true),
    ("dice", "pink", false),
    ("dice", "black", false),
    ("needle", "red", false),
    ("needle", "lime", false),
    ("needle", "cyan", false),
    ("needle", "white", false),
    ("needle", "gold", true),
    ("ornament", "ball", false),
    ("ornament", "star", false),
    ("ornament", "gold", true),
    ("ornament", "bird", false),
    ("ornament", "flag", false),
    ("dash", "wood", false),
    ("dash", "carbon", false),
    ("dash", "gold", true),
    ("dash", "red", false),
    ("dash", "ivory", false),
    ("indicator", "red", false),
    ("indicator", "green", false),
    ("indicator", "gold", true),
    ("indicator", "ice", false),
    ("indicator", "white", false),
    ("phone", "silver", false),
    ("phone", "gold", true),
    ("phone", "red", false),
    ("phone", "blue", false),
    ("phone", "clear", false),
];

fn fits(buf: &[u8; 16], name: &str) -> bool {
    let raw = name.as_bytes();
    let n = raw.len();
    n <= 16 && &buf[..n] == raw && buf[n..].iter().all(|b| *b == 0)
}

pub(crate) fn part_price(slot: &[u8; 16], item: &[u8; 16]) -> Result<u64> {
    let price = LISTED.iter().find_map(|&(slot_name, item_name, gold)| {
        (fits(slot, slot_name) && fits(item, item_name)).then_some(if gold {
            GOLD_PART
        } else {
            ORDINARY_PART
        })
    });
    price.ok_or(HonkError::NotForSale.into())
}

pub(crate) fn is_gold(price: u64) -> bool {
    price == GOLD_PART
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(name: &str) -> [u8; 16] {
        let mut out = [0u8; 16];
        out[..name.len()].copy_from_slice(name.as_bytes());
        out
    }

    #[test]
    fn listed_pairs_match_the_two_prices() {
        let mut gold = 0;
        let mut ordinary = 0;
        for &(slot, item, is_gold_row) in LISTED {
            let price = part_price(&bytes(slot), &bytes(item)).unwrap();
            if is_gold_row {
                gold += 1;
                assert_eq!(price, GOLD_PART, "{slot}/{item}");
            } else {
                ordinary += 1;
                assert_eq!(price, ORDINARY_PART, "{slot}/{item}");
            }
        }
        assert_eq!(gold, 8);
        assert_eq!(ordinary, 37);
    }

    #[test]
    fn defaults_and_unknown_pairs_are_not_for_sale() {
        for (slot, item) in [
            ("wheel", "classic"),
            ("truck_color", "red"),
            ("truck_color", "gold"),
            ("gearbox", "stick"),
            ("dice", "white"),
            ("needle", "orange"),
            ("ornament", "spear"),
            ("dash", "stock"),
            ("indicator", "amber"),
            ("phone", "black"),
            ("wheel", "nope"),
            ("seat", "gold"),
        ] {
            assert!(
                part_price(&bytes(slot), &bytes(item)).is_err(),
                "{slot}/{item}"
            );
        }
        let mut dirty = bytes("gold");
        dirty[4] = 1;
        assert!(part_price(&bytes("wheel"), &dirty).is_err());
    }
}
