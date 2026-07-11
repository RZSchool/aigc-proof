use serde::Serialize;
use serde_json::Value;

use proof_schema::{Event, validate_event_schema};

use crate::{CoreError, CoreResult, ErrorKind, sha256_bytes};

#[derive(Serialize)]
struct EventHashInput<'a> {
    event_id: &'a str,
    sequence: u64,
    event_type: &'a str,
    created_at: &'a str,
    previous_event_hash: &'a Option<String>,
    payload: &'a Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventChainIssue {
    pub code: &'static str,
    pub index: usize,
    pub message: String,
}

pub fn canonical_json(value: &impl Serialize) -> CoreResult<Vec<u8>> {
    serde_json_canonicalizer::to_vec(value).map_err(|error| {
        CoreError::new(
            ErrorKind::PackageFormat,
            "JCS_CANONICALIZATION_FAILED",
            error.to_string(),
        )
    })
}

pub fn event_digest(event: &Event) -> CoreResult<String> {
    let input = EventHashInput {
        event_id: &event.event_id,
        sequence: event.sequence,
        event_type: &event.event_type,
        created_at: &event.created_at,
        previous_event_hash: &event.previous_event_hash,
        payload: &event.payload,
    };
    Ok(sha256_bytes(&canonical_json(&input)?))
}

pub fn create_event(
    existing: &[Event],
    event_id: String,
    event_type: String,
    created_at: String,
    payload: Value,
) -> CoreResult<Event> {
    let sequence = existing.len() as u64 + 1;
    let previous_event_hash = existing.last().map(|event| event.event_hash.clone());
    let mut event = Event {
        event_id,
        sequence,
        event_type,
        created_at,
        previous_event_hash,
        payload,
        event_hash: "0".repeat(64),
    };
    let issues = event.validate(sequence);
    if let Some(issue) = issues.first() {
        return Err(CoreError::new(
            ErrorKind::InvalidEventChain,
            issue.code,
            format!("{}: {}", issue.field, issue.message),
        ));
    }
    event.event_hash = event_digest(&event)?;
    Ok(event)
}

pub fn verify_event_chain(events: &[Event]) -> Vec<EventChainIssue> {
    let mut issues = Vec::new();
    let mut previous: Option<&str> = None;
    let mut event_ids = std::collections::HashSet::new();
    for (index, event) in events.iter().enumerate() {
        let expected_sequence = index as u64 + 1;
        for issue in event.validate(expected_sequence) {
            issues.push(EventChainIssue {
                code: issue.code,
                index,
                message: format!("{}: {}", issue.field, issue.message),
            });
        }
        if !event_ids.insert(event.event_id.as_str()) {
            issues.push(EventChainIssue {
                code: "EVENT_ID_DUPLICATE",
                index,
                message: "Event IDs must be unique.".to_owned(),
            });
        }
        if let Ok(value) = serde_json::to_value(event) {
            if let Err(schema_errors) = validate_event_schema(&value) {
                for message in schema_errors {
                    issues.push(EventChainIssue {
                        code: "EVENT_SCHEMA_INVALID",
                        index,
                        message,
                    });
                }
            }
        } else {
            issues.push(EventChainIssue {
                code: "EVENT_SERIALIZATION_FAILED",
                index,
                message: "Event could not be represented as JSON.".to_owned(),
            });
        }
        if event.previous_event_hash.as_deref() != previous {
            issues.push(EventChainIssue {
                code: "EVENT_PREVIOUS_HASH_MISMATCH",
                index,
                message: "previous_event_hash does not match the preceding event.".to_owned(),
            });
        }
        match event_digest(event) {
            Ok(expected) if event.event_hash != expected => issues.push(EventChainIssue {
                code: "EVENT_HASH_MISMATCH",
                index,
                message: "event_hash does not match canonical event content.".to_owned(),
            }),
            Err(error) => issues.push(EventChainIssue {
                code: error.code,
                index,
                message: error.message,
            }),
            Ok(_) => {}
        }
        previous = Some(event.event_hash.as_str());
    }
    issues
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn fixed_event(events: &[Event], id: &str) -> Event {
        create_event(
            events,
            id.to_owned(),
            "generation".to_owned(),
            "2026-07-10T12:30:45Z".to_owned(),
            json!({"model": "demo"}),
        )
        .unwrap()
    }

    #[test]
    fn first_and_multiple_events_form_a_chain() {
        let first = fixed_event(&[], "550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(first.sequence, 1);
        assert_eq!(first.previous_event_hash, None);
        let second = fixed_event(
            std::slice::from_ref(&first),
            "550e8400-e29b-41d4-a716-446655440001",
        );
        assert_eq!(second.sequence, 2);
        assert_eq!(
            second.previous_event_hash.as_deref(),
            Some(first.event_hash.as_str())
        );
        assert!(verify_event_chain(&[first, second]).is_empty());
    }

    #[test]
    fn reorder_previous_hash_and_event_hash_changes_are_detected() {
        let first = fixed_event(&[], "550e8400-e29b-41d4-a716-446655440000");
        let second = fixed_event(
            std::slice::from_ref(&first),
            "550e8400-e29b-41d4-a716-446655440001",
        );
        let mut reordered = vec![second.clone(), first.clone()];
        assert!(!verify_event_chain(&reordered).is_empty());
        reordered = vec![first.clone(), second.clone()];
        reordered[1].previous_event_hash = Some("0".repeat(64));
        assert!(
            verify_event_chain(&reordered)
                .iter()
                .any(|issue| issue.code == "EVENT_PREVIOUS_HASH_MISMATCH")
        );
        reordered = vec![first, second];
        reordered[0].event_hash = "0".repeat(64);
        assert!(
            verify_event_chain(&reordered)
                .iter()
                .any(|issue| issue.code == "EVENT_HASH_MISMATCH")
        );
    }

    #[test]
    fn duplicate_event_ids_are_rejected() {
        let first = fixed_event(&[], "550e8400-e29b-41d4-a716-446655440000");
        let second = fixed_event(std::slice::from_ref(&first), &first.event_id);
        assert!(
            verify_event_chain(&[first, second])
                .iter()
                .any(|issue| issue.code == "EVENT_ID_DUPLICATE")
        );
    }
}
