import os
from pathlib import Path
import sys
import unittest
from datetime import datetime, timedelta, timezone
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa, padding as asym_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.x509.oid import NameOID

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build_epk import build, inspect, IV

class TestEpk(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "offline-test")])
        cls.cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                    .public_key(cls.private.public_key()).serial_number(x509.random_serial_number())
                    .not_valid_before(datetime.now(timezone.utc) - timedelta(days=1))
                    .not_valid_after(datetime.now(timezone.utc) + timedelta(days=1))
                    .sign(cls.private, hashes.SHA256()))
        from cryptography.hazmat.primitives.serialization import Encoding
        cls.pem = cls.cert.public_bytes(Encoding.PEM)

    def test_build_parse_and_crypto_roundtrip(self):
        source = b'PK\x03\x04' + os.urandom(1067)
        blob = build(source, 'q50-native.apk', self.pem)
        fields = inspect(blob)
        self.assertEqual(fields['filename'], 'q50-native.apk')
        self.assertEqual(fields['blocks'], 1)
        key_size = int.from_bytes(blob[10:12], 'big')
        key = self.private.decrypt(blob[12:12+key_size], asym_padding.PKCS1v15())
        decryptor = Cipher(algorithms.AES(key.ljust(32, b'\0')), modes.CBC(IV)).decryptor()
        raw = decryptor.update(blob[400:]) + decryptor.finalize()
        self.assertEqual(raw[:-raw[-1]], source)

    def test_invalid_files_rejected(self):
        with self.assertRaises(ValueError): build(b'NOT AN APK', 'q50.apk', self.pem)
        with self.assertRaises(ValueError): build(b'PK\x03\x04xxxx', '../evil.apk', self.pem)
        with self.assertRaises(ValueError): inspect(b'not an epk')

if __name__ == '__main__': unittest.main()
