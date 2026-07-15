#!/usr/bin/env python3
"""Verify the frozen creator-signature vector with Python stdlib and OpenSSL."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def read_uint(data: bytes, offset: int, additional: int) -> tuple[int, int]:
    if additional < 24:
        return additional, offset
    sizes = {24: 1, 25: 2, 26: 4, 27: 8}
    size = sizes.get(additional)
    if size is None or offset + size > len(data):
        raise ValueError("unsupported or truncated CBOR integer")
    return int.from_bytes(data[offset : offset + size], "big"), offset + size


def decode(data: bytes, offset: int = 0):
    if offset >= len(data):
        raise ValueError("truncated CBOR")
    initial = data[offset]
    offset += 1
    major, additional = initial >> 5, initial & 0x1F
    if major in (0, 1):
        value, offset = read_uint(data, offset, additional)
        return (value if major == 0 else -1 - value), offset
    if major in (2, 3):
        size, offset = read_uint(data, offset, additional)
        end = offset + size
        if end > len(data):
            raise ValueError("truncated CBOR string")
        value = data[offset:end]
        return (value if major == 2 else value.decode("utf-8")), end
    if major == 4:
        size, offset = read_uint(data, offset, additional)
        values = []
        for _ in range(size):
            value, offset = decode(data, offset)
            values.append(value)
        return values, offset
    if major == 5:
        size, offset = read_uint(data, offset, additional)
        values = {}
        for _ in range(size):
            key, offset = decode(data, offset)
            value, offset = decode(data, offset)
            values[key] = value
        return values, offset
    if major == 6:
        tag, offset = read_uint(data, offset, additional)
        value, offset = decode(data, offset)
        return ("tag", tag, value), offset
    if major == 7 and additional == 22:
        return None, offset
    raise ValueError("unsupported CBOR item")


def encoded_head(major: int, size: int) -> bytes:
    if size < 24:
        return bytes([(major << 5) | size])
    if size < 256:
        return bytes([(major << 5) | 24, size])
    if size < 65536:
        return bytes([(major << 5) | 25]) + size.to_bytes(2, "big")
    raise ValueError("vector item is unexpectedly large")


def encoded_bytes(value: bytes) -> bytes:
    return encoded_head(2, len(value)) + value


def encoded_text(value: str) -> bytes:
    raw = value.encode("utf-8")
    return encoded_head(3, len(raw)) + raw


def signature_structure(protected: bytes, aad: bytes, digest: bytes) -> bytes:
    return (
        encoded_head(4, 4)
        + encoded_text("Signature1")
        + encoded_bytes(protected)
        + encoded_bytes(aad)
        + encoded_bytes(digest)
    )


def decode_exact(data: bytes):
    value, offset = decode(data)
    if offset != len(data):
        raise ValueError("trailing CBOR bytes")
    return value


def openssl_verify(public: bytes, message: bytes, signature: bytes) -> bool:
    spki = bytes.fromhex("302a300506032b6570032100") + public
    with tempfile.TemporaryDirectory(prefix="aigc-proof-vector-") as directory:
        root = Path(directory)
        public_path = root / "public.der"
        message_path = root / "message.bin"
        signature_path = root / "signature.bin"
        public_path.write_bytes(spki)
        message_path.write_bytes(message)
        signature_path.write_bytes(signature)
        result = subprocess.run(
            [
                "openssl",
                "pkeyutl",
                "-verify",
                "-pubin",
                "-inkey",
                str(public_path),
                "-keyform",
                "DER",
                "-rawin",
                "-in",
                str(message_path),
                "-sigfile",
                str(signature_path),
            ],
            check=False,
            capture_output=True,
        )
        return result.returncode == 0


def main() -> int:
    repository = Path(__file__).resolve().parents[1]
    vector_path = (
        repository
        / "tests"
        / "test-vectors"
        / "creator-signature"
        / "ed25519-cose-sign1.json"
    )
    vector = json.loads(vector_path.read_text(encoding="utf-8"))
    manifest = vector["manifest_utf8"].encode("utf-8")
    digest = hashlib.sha256(manifest).digest()
    if digest.hex() != vector["manifest_sha256"]:
        raise ValueError("manifest digest mismatch")

    key_bytes = bytes.fromhex(vector["public_key_cose_hex"])
    if hashlib.sha256(key_bytes).hexdigest() != vector["public_key_sha256"]:
        raise ValueError("COSE_Key fingerprint mismatch")
    key = decode_exact(key_bytes)
    if set(key) != {1, 3, -1, -2} or key[1] != 1 or key[3] != -8 or key[-1] != 6:
        raise ValueError("unexpected COSE_Key profile")
    public = key[-2]
    if not isinstance(public, bytes) or len(public) != 32:
        raise ValueError("invalid Ed25519 public key")

    sign1 = decode_exact(bytes.fromhex(vector["cose_sign1_hex"]))
    if not isinstance(sign1, tuple) or sign1[:2] != ("tag", 18):
        raise ValueError("COSE_Sign1 tag is missing")
    protected, unprotected, payload, signature = sign1[2]
    if unprotected != {} or payload is not None or len(signature) != 64:
        raise ValueError("unexpected COSE_Sign1 layout")
    headers = decode_exact(protected)
    if headers != {1: -8, 4: hashlib.sha256(key_bytes).digest()}:
        raise ValueError("unexpected protected headers")

    aad = bytes.fromhex(vector["external_aad_utf8_hex"])
    message = signature_structure(protected, aad, digest)
    if not openssl_verify(public, message, signature):
        raise ValueError("OpenSSL rejected the frozen vector")
    wrong_digest = hashlib.sha256(manifest + b" ").digest()
    if openssl_verify(public, signature_structure(protected, aad, wrong_digest), signature):
        raise ValueError("OpenSSL accepted a substituted Manifest")
    print("creator-signature vector: valid; substituted Manifest: rejected")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"creator-signature vector verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
