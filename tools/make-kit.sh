#!/bin/bash
# Build dist/sonar-recorder-kit.zip: the menu bar recorder plus a double-click launcher, for friends.
set -e
cd "$(dirname "$0")/.."
rm -rf dist/sonar-recorder-kit && mkdir -p dist/sonar-recorder-kit/collect
cp collect/menubar.py collect/recorder.py collect/guide.py collect/icon.svg dist/sonar-recorder-kit/collect/
cp kit/* dist/sonar-recorder-kit/
(cd dist && rm -f sonar-recorder-kit.zip && zip -qr sonar-recorder-kit.zip sonar-recorder-kit)
echo "built dist/sonar-recorder-kit.zip ($(du -h dist/sonar-recorder-kit.zip | cut -f1))"
