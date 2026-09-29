# scRO client provenance

- User-specified site: https://scro.online/
- On 2026-09-29 its visible menu download link pointed to `https://mugenworld.ru/client/` (DNS resolution failed), while its quick-links block pointed to this Google Drive file: https://drive.google.com/file/d/1gvN3SRG5w5PsxfMQ7SRo31cLDjvsceKa/view
- Google Drive displayed `scRO.zip` (3.8G) and a standard warning that it cannot virus-scan such a large file. The confirmation endpoint returned HTTP 206, `Content-Disposition: attachment; filename="scRO.zip"`, total 4,128,439,606 bytes. Downloaded with byte-range verification; no EXE was run.
- Downloaded ZIP (now deleted at the user's request after verified extraction): `scRO.zip`, 4,128,439,606 bytes; SHA-256 locally computed before deletion (no published comparison checksum): `1922e2b9b14b713f67e8cadccb35113bbc4a66d5894228ae1a0fd7d510bc6887`.
- `unzip -tq` passed; 3,224 entries / 3,207 files / 4,290,803,811 uncompressed bytes. No absolute, parent-traversal, drive-letter paths, duplicate names or symlinks. After extraction, all 3,207 files were checked against the ZIP for size and CRC32; all matched. Only then the source ZIP was deleted.
- Extracted client: `/root/ro-client-extraction-2/client/scRO/`. GRFs: `data.grf` 3,029,746,472 bytes; `rdata.grf` 737,436,851 bytes; `patch.grf` 37,281,805 bytes. The ZIP also contained two shortcut files at the `client/` level.
- This is the private server's client linked from scro.online, not an official Gravity release or a verified exact Episode 19 snapshot. GRF files exist on disk, but their *internal* contents have not been extracted. Do not execute the bundled EXEs or publish client assets without separate authorization.
