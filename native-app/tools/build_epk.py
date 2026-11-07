#!/usr/bin/env python3
"""Package an APK you built yourself as an observed App Garage EPK v2 envelope.

Protocol interoperability based on the public MIT-licensed research at:
  https://github.com/bugjosh/appgarage-dash
Only a matching PUBLIC device certificate is used; no private device keys needed.
This legacy package format uses deterministic AES-CBC IV because of the receiver's
historic implementation. It provides no authenticated encryption or signatures.
APK signing is a separate step in build.ps1.
"""
import argparse
import os
from pathlib import Path
import struct

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b".epk"
IV = bytes.fromhex("0123456789abcdef") + b"\0" * 8


def build(apk: bytes, filename: str, cert_pem: bytes) -> bytes:
    if not apk.startswith(b"PK\x03\x04"):
        raise ValueError("APK must be a ZIP-format file beginning with PK signature")
    encoded_name = filename.encode("ascii")
    if not encoded_name or len(encoded_name) > 128 or "/" in filename or "\\" in filename:
        raise ValueError("Unsafe APK filename")
    pub = x509.load_pem_x509_certificate(cert_pem).public_key()
    # 20-byte session material, as observed in this legacy EPK v2 reader.
    session = os.urandom(20).hex()[:20].encode("ascii")
    wrapped = pub.encrypt(session, asym_padding.PKCS1v15())
    if len(wrapped) > 256:
        raise ValueError("Wrapped session key does not fit legacy 256-byte header")
    aes_key = session + b"\0" * (32 - len(session))
    pad_size = 16 - len(apk) % 16
    padded = apk + bytes([pad_size]) * pad_size
    encryptor = Cipher(algorithms.AES(aes_key), modes.CBC(IV)).encryptor()
    payload = encryptor.update(padded) + encryptor.finalize()
    return (MAGIC + struct.pack(">HHHH", 2, 2, 1, len(wrapped))
            + wrapped.ljust(256, b"\0")
            + encoded_name.ljust(128, b"\0")
            + struct.pack(">i", len(payload)) + payload)


def inspect(blob: bytes):
    if len(blob) < 400 or blob[:4] != MAGIC:
        raise ValueError("Not an EPK v2 package")
    version, kind, count, key_length = struct.unpack_from(">HHHH", blob, 4)
    if version != 2 or count != 1 or kind != 2 or key_length < 1 or key_length > 256:
        raise ValueError("Unexpected EPK header")
    name = blob[268:396].split(b"\0", 1)[0].decode("ascii")
    length = struct.unpack_from(">i", blob, 396)[0]
    if length <= 0 or length % 16 != 0 or len(blob) != 400 + length:
        raise ValueError("Incorrect encrypted payload length")
    return {"version": version, "kind": kind, "blocks": count, "filename": name,
            "payload_length": length, "size": len(blob)}


def main():
    p = argparse.ArgumentParser(description="Package a signed Q50 Android APK as EPK v2")
    p.add_argument("--apk", type=Path, required=True)
    p.add_argument("--cert", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    blob = build(args.apk.read_bytes(), args.apk.name, args.cert.read_bytes())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(blob)
    print("Created", args.out)
    print("Validated envelope:", inspect(blob))
    print("Vehicle compatibility and installation are NOT verified by this check.")


if __name__ == "__main__":
    main()
