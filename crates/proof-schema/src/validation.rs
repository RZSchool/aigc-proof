use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};
use unicode_normalization::UnicodeNormalization;

pub fn validate_sha256_hex(value: &str) -> Result<(), &'static str> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err("must be exactly 64 lowercase hexadecimal characters")
    }
}

pub fn validate_display_label(value: &str) -> Result<(), &'static str> {
    if value.is_empty() || value.len() > 200 {
        return Err("display label must contain 1-200 UTF-8 bytes");
    }
    if value.nfc().collect::<String>() != value {
        return Err("display label must be Unicode NFC normalized");
    }
    if value.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '\u{061c}'
                    | '\u{200e}'
                    | '\u{200f}'
                    | '\u{202a}'..='\u{202e}'
                    | '\u{2066}'..='\u{2069}'
            )
    }) {
        return Err("display label must not contain control or bidi-control characters");
    }
    Ok(())
}

pub fn display_label_needs_confusable_warning(value: &str) -> bool {
    !value.is_ascii()
}

pub fn validate_package_path(value: &str) -> Result<(), &'static str> {
    if value.is_empty() || value.len() > 1024 {
        return Err("path must contain 1-1024 bytes");
    }
    if value.starts_with('/') || value.starts_with("\\\\") {
        return Err("absolute and UNC paths are forbidden");
    }
    if value.contains('\\') || value.contains('\0') || value.contains(':') {
        return Err("backslashes, drive prefixes, colons, and NUL bytes are forbidden");
    }
    if value.ends_with('/') {
        return Err("directory paths are forbidden");
    }
    for component in value.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err("empty, dot, and parent path components are forbidden");
        }
        validate_portable_component(component)?;
    }
    Ok(())
}

pub fn validate_portable_basename(value: &str) -> Result<(), &'static str> {
    if value.is_empty() || value.len() > 255 || matches!(value, "." | "..") {
        return Err("basename must contain 1-255 bytes and cannot be dot or parent");
    }
    if value.contains('/') || value.contains('\\') || value.contains(':') || value.contains('\0') {
        return Err("basename must not contain separators, colons, or NUL bytes");
    }
    validate_portable_component(value)
}

pub fn validate_uuid(value: &str) -> Result<(), &'static str> {
    if uuid::Uuid::parse_str(value).is_ok_and(|parsed| parsed.to_string() == value) {
        Ok(())
    } else {
        Err("must be a canonical lowercase UUID")
    }
}

pub fn validate_proof_id(value: &str) -> Result<(), &'static str> {
    if value
        .strip_prefix("urn:uuid:")
        .is_some_and(|uuid| validate_uuid(uuid).is_ok())
    {
        Ok(())
    } else {
        Err("must be a lowercase urn:uuid value")
    }
}

pub fn validate_media_type(value: &str) -> Result<(), &'static str> {
    let Some((kind, subtype)) = value.split_once('/') else {
        return Err("media type must contain one type/subtype separator");
    };
    if value.len() > 255
        || subtype.contains('/')
        || !valid_media_token(kind)
        || !valid_media_token(subtype)
    {
        return Err("media type must be an ASCII type/subtype without parameters");
    }
    Ok(())
}

fn validate_portable_component(value: &str) -> Result<(), &'static str> {
    if value.ends_with([' ', '.']) {
        return Err("path components must not end with a space or dot");
    }
    if value.chars().any(|character| {
        character.is_control() || matches!(character, '<' | '>' | '"' | '|' | '?' | '*')
    }) {
        return Err("path components contain a character forbidden by portable filesystems");
    }
    let device_stem = value.split('.').next().unwrap_or(value);
    if is_windows_device_name(device_stem) {
        return Err("Windows reserved device names are forbidden");
    }
    Ok(())
}

fn is_windows_device_name(value: &str) -> bool {
    let upper = value.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || upper
        .strip_prefix("COM")
        .or_else(|| upper.strip_prefix("LPT"))
        .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
}

fn valid_media_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"!#$&^_.+-".contains(&byte))
}

pub fn validate_asset_role(value: &str) -> Result<(), &'static str> {
    match value {
        "input" | "output" | "reference" | "license" | "other" => Ok(()),
        _ => Err("role must be input, output, reference, license, or other"),
    }
}

pub fn validate_event_type(value: &str) -> Result<(), &'static str> {
    if value.is_empty() || value.len() > 64 {
        return Err("event type must contain 1-64 bytes");
    }
    let mut bytes = value.bytes();
    if !bytes.next().is_some_and(|byte| byte.is_ascii_lowercase()) {
        return Err("event type must start with a lowercase ASCII letter");
    }
    if bytes
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte))
    {
        Ok(())
    } else {
        Err(
            "event type may contain only lowercase ASCII letters, digits, dot, dash, and underscore",
        )
    }
}

pub fn parse_canonical_rfc3339(value: &str) -> Result<OffsetDateTime, String> {
    if !value.is_ascii() || value.as_bytes().get(10) != Some(&b'T') {
        return Err("timestamp must use an uppercase T separator".to_owned());
    }
    if !(value.ends_with('Z') || has_numeric_offset(value)) {
        return Err("timestamp must include Z or a numeric timezone offset".to_owned());
    }
    OffsetDateTime::parse(value, &Rfc3339)
        .map_err(|error| format!("invalid RFC 3339 timestamp: {error}"))
}

pub fn format_canonical_utc(value: OffsetDateTime) -> Result<String, String> {
    let formatted = value
        .to_offset(UtcOffset::UTC)
        .format(&Rfc3339)
        .map_err(|error| format!("cannot format RFC 3339 timestamp: {error}"))?;
    if let Some(prefix) = formatted.strip_suffix("+00:00") {
        Ok(format!("{prefix}Z"))
    } else {
        Ok(formatted)
    }
}

pub fn normalize_rfc3339(value: &str) -> Result<String, String> {
    format_canonical_utc(parse_canonical_rfc3339(value)?)
}

pub fn validate_canonical_timestamp(value: &str) -> Result<(), String> {
    let normalized = normalize_rfc3339(value)?;
    if normalized == value {
        Ok(())
    } else {
        Err(format!(
            "timestamp must be canonical UTC Z form; use {normalized}"
        ))
    }
}

fn has_numeric_offset(value: &str) -> bool {
    if value.len() < 25 {
        return false;
    }
    let suffix = &value[value.len() - 6..];
    matches!(suffix.as_bytes().first(), Some(&b'+') | Some(&b'-'))
        && suffix.as_bytes().get(3) == Some(&b':')
        && suffix
            .bytes()
            .enumerate()
            .all(|(index, byte)| matches!(index, 0 | 3) || byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_are_strict_and_normalized_to_utc() {
        assert!(validate_canonical_timestamp("2026-07-10T12:30:45Z").is_ok());
        assert!(validate_canonical_timestamp("2026-07-10T12:30:45.123456Z").is_ok());
        assert_eq!(
            normalize_rfc3339("2026-07-10T20:30:45+08:00").unwrap(),
            "2026-07-10T12:30:45Z"
        );
        for invalid in [
            "2026-07-10 12:30:45Z",
            "2026-07-10T12:30:45",
            "2026-13-10T12:30:45Z",
            "2026-02-30T12:30:45Z",
            "2026-07-10T12:30:45Zextra",
        ] {
            assert!(
                parse_canonical_rfc3339(invalid).is_err(),
                "accepted {invalid}"
            );
        }
    }

    #[test]
    fn paths_reject_cross_platform_escape_forms() {
        assert!(validate_package_path("assets/input/example.txt").is_ok());
        for invalid in [
            "../x",
            "/x",
            r"C:\x",
            r"\\server\share",
            r"a\b",
            "a//b",
            "./x",
            "x/",
            "assets/input/bad?.txt",
            "assets/input/trailing. ",
            "assets/input/CON",
        ] {
            assert!(
                validate_package_path(invalid).is_err(),
                "accepted {invalid}"
            );
        }
    }

    #[test]
    fn identifiers_basenames_and_media_types_are_portable() {
        assert!(validate_uuid("550e8400-e29b-41d4-a716-446655440000").is_ok());
        assert!(validate_uuid("550E8400-E29B-41D4-A716-446655440000").is_err());
        assert!(validate_proof_id("urn:uuid:550e8400-e29b-41d4-a716-446655440000").is_ok());
        assert!(validate_portable_basename("example.txt").is_ok());
        assert!(validate_portable_basename("bad?.txt").is_err());
        assert!(validate_portable_basename("NUL.txt").is_err());
        assert!(validate_media_type("application/ld+json").is_ok());
        assert!(validate_media_type("text/").is_err());
        assert!(validate_media_type("text/plain; charset=utf-8").is_err());
    }

    #[test]
    fn digests_are_lowercase_and_fixed_width() {
        let valid = "a".repeat(64);
        assert!(validate_sha256_hex(&valid).is_ok());
        assert!(validate_sha256_hex(&"A".repeat(64)).is_err());
        assert!(validate_sha256_hex(&"a".repeat(63)).is_err());
    }

    #[test]
    fn display_labels_require_nfc_and_reject_controls() {
        assert!(validate_display_label("Creator 甲").is_ok());
        assert!(validate_display_label("e\u{301}").is_err());
        assert!(validate_display_label("bad\nlabel").is_err());
        assert!(validate_display_label("\u{202e}spoof").is_err());
        assert!(display_label_needs_confusable_warning("Creator 甲"));
    }
}
