use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::{CoreError, CoreResult, ErrorKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigestResult {
    pub size: u64,
    pub sha256: String,
}

pub fn sha256_bytes(bytes: &[u8]) -> String {
    encode_hex(&Sha256::digest(bytes))
}

pub fn sha256_reader(reader: &mut impl Read) -> CoreResult<DigestResult> {
    copy_and_hash(reader, &mut std::io::sink())
}

pub fn sha256_file(path: &Path) -> CoreResult<DigestResult> {
    let mut file =
        File::open(path).map_err(|error| CoreError::io("FILE_OPEN_FAILED", path, error))?;
    sha256_reader(&mut file)
}

pub(crate) fn copy_and_hash(
    reader: &mut impl Read,
    writer: &mut impl Write,
) -> CoreResult<DigestResult> {
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer).map_err(|error| {
            CoreError::new(ErrorKind::Io, "STREAM_READ_FAILED", error.to_string())
        })?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(|error| {
            CoreError::new(ErrorKind::Io, "STREAM_WRITE_FAILED", error.to_string())
        })?;
        hasher.update(&buffer[..read]);
        size = size.checked_add(read as u64).ok_or_else(|| {
            CoreError::new(
                ErrorKind::LimitExceeded,
                "SIZE_OVERFLOW",
                "Stream size overflowed u64.",
            )
        })?;
    }
    Ok(DigestResult {
        size,
        sha256: encode_hex(&hasher.finalize()),
    })
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            sha256_bytes(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn reader_hashes_in_chunks_and_reports_size() {
        let bytes = vec![b'x'; 3 * 64 * 1024 + 17];
        let mut reader = std::io::Cursor::new(&bytes);
        let digest = sha256_reader(&mut reader).unwrap();
        assert_eq!(digest.size, bytes.len() as u64);
        assert_eq!(digest.sha256, sha256_bytes(&bytes));
    }
}
