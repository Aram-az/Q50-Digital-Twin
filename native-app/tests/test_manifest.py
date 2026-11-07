from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
A = '{http://schemas.android.com/apk/res/android}'

class TestManifest(unittest.TestCase):
    def test_read_only_and_api10(self):
        tree = ET.parse(ROOT / 'AndroidManifest.xml')
        root = tree.getroot()
        self.assertEqual(root.attrib['package'], 'com.aram.q50telemetry')
        sdk = root.find('uses-sdk')
        self.assertEqual(sdk.attrib[A+'minSdkVersion'], '10')
        permissions = {p.attrib[A+'name'] for p in root.findall('uses-permission')}
        self.assertEqual(permissions, {'com.ygomi.permission.IVI_CAN_READ'})
        app = root.find('application')
        meta = {p.attrib[A+'name']: p.attrib[A+'value'] for p in app.findall('meta-data')}
        self.assertEqual(meta['ivi.isDistractive'], 'true')
        self.assertEqual(meta['ivi.autorun'], 'false')
        self.assertEqual(app.attrib[A+'debuggable'], 'false')

if __name__ == '__main__': unittest.main()
