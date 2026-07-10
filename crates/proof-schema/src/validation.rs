use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};

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
    if value
        .split('/')
        .any(|component| component.is_empty() || component == "." || component == "..")
    {
        return Err("empty, dot, and parent path components are forbidden");
    }
    Ok(())
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
    if bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte))
    {
        Ok(())
    } else {
        Err("event type may contain only lowercase ASCII letters, digits, dot, dash, and underscore")
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
        Err(format!("timestamp must be canonical UTC Z form; use {normalized}"))
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
            assert!(parse_canonical_rfc3339(invalid).is_err(), "accepted {invalid}");
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
        ] {
            assert!(validate_package_path(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn digests_are_lowercase_and_fixed_width() {
        let valid = "a".repeat(64);
        assert!(validate_sha256_hex(&valid).is_ok());
        assert!(validate_sha256_hex(&"A".repeat(64)).is_err());
        assert!(validate_sha256_hex(&"a".repeat(63)).is_err());
    }
}
