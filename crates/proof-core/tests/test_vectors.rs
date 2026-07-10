use proof_core::{canonical_json, event_digest, sha256_bytes};
use proof_schema::{Event, parse_json_strict};
use serde_json::Value;

#[test]
fn committed_hash_jcs_and_event_vectors_match() {
    let hash_input_hex =
        include_str!("../../../tests/test-vectors/hashes/input.hex").trim();
    assert_eq!(hash_input_hex, "616263");
    assert_eq!(
        sha256_bytes(b"abc"),
        include_str!("../../../tests/test-vectors/hashes/expected-sha256.txt").trim()
    );

    let canonical_input: Value = parse_json_strict(include_bytes!(
        "../../../tests/test-vectors/canonical-json/input.json"
    ))
    .unwrap();
    let canonical = canonical_json(&canonical_input).unwrap();
    assert_eq!(
        canonical,
        include_str!("../../../tests/test-vectors/canonical-json/expected.jcs.json")
            .trim()
            .as_bytes()
    );
    assert_eq!(
        sha256_bytes(&canonical),
        include_str!("../../../tests/test-vectors/canonical-json/expected-sha256.txt").trim()
    );

    let input: Value = parse_json_strict(include_bytes!(
        "../../../tests/test-vectors/event-chain/input-event-without-hash.json"
    ))
    .unwrap();
    let event = Event {
        event_id: input["event_id"].as_str().unwrap().to_owned(),
        sequence: input["sequence"].as_u64().unwrap(),
        event_type: input["event_type"].as_str().unwrap().to_owned(),
        created_at: input["created_at"].as_str().unwrap().to_owned(),
        previous_event_hash: None,
        payload: input["payload"].clone(),
        event_hash: "0".repeat(64),
    };
    assert_eq!(
        event_digest(&event).unwrap(),
        include_str!("../../../tests/test-vectors/event-chain/expected-event-hash.txt").trim()
    );
}
