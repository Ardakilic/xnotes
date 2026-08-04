# note-encryption — Delta Spec

## ADDED Requirements

### Requirement: Optional end-to-end encryption envelope
When encryption is enabled for a backend, the system SHALL encrypt the `StoreV2` JSON before upload and decrypt after download, so the backend stores only an opaque envelope: `{ v: 1, cipher: "aes-256-gcm", kdf: "pbkdf2-sha256", iter, salt, iv, data }` with `salt` (16 bytes) and `iv` (12 bytes) random per encryption and `data` the base64 ciphertext. Encryption SHALL be implemented with WebCrypto (`crypto.subtle`) only, and SHALL work identically on Chromium and Gecko background contexts. When encryption is disabled, the blob SHALL be plain `StoreV2` JSON.

#### Scenario: Round-trip
- **WHEN** a store is encrypted with a passphrase and then decrypted with the same passphrase
- **THEN** the decrypted store deep-equals the original

#### Scenario: Fresh randomness per upload
- **WHEN** the same store is encrypted twice
- **THEN** the envelopes differ in `salt`, `iv`, and ciphertext

#### Scenario: Backend sees only opaque bytes
- **WHEN** encryption is enabled and a sync PUT happens
- **THEN** the uploaded body is the envelope and contains no plaintext note text or handles

### Requirement: Key derivation
The encryption key SHALL be derived from the user's passphrase via PBKDF2-HMAC-SHA256 with at least 600,000 iterations and the envelope's random salt. The passphrase SHALL never be persisted anywhere; it SHALL be held only as long as needed to derive the key for a sync operation or settings change.

#### Scenario: Passphrase not stored
- **WHEN** encryption settings are saved
- **THEN** no storage key, log line, or uploaded payload contains the passphrase

### Requirement: Wrong passphrase and corruption handling
Decryption failure (GCM authentication tag mismatch) SHALL produce a typed "decryption failed (wrong passphrase?)" error surfaced in sync status, and SHALL NOT overwrite or corrupt the local store. Unknown envelope versions, malformed envelopes, and envelopes declaring fewer than the minimum PBKDF2 iterations SHALL produce a typed error with the same guarantees.

#### Scenario: Wrong passphrase
- **WHEN** the remote envelope is decrypted with a wrong passphrase
- **THEN** sync ends in error state with the wrong-passphrase message and the local store is untouched

#### Scenario: Corrupt envelope
- **WHEN** the remote blob is not a valid envelope (garbage bytes or unknown `v`)
- **THEN** sync ends in a typed error and the local store is untouched

#### Scenario: Weak key derivation rejected
- **WHEN** the remote envelope declares fewer than 600,000 PBKDF2 iterations
- **THEN** decryption fails with a typed error and the local store is untouched

### Requirement: Encryption mode mismatch handling
If the remote blob is an encryption envelope while encryption is disabled locally, the system SHALL fail with a typed error telling the user the remote data is encrypted and encryption must be enabled (with the passphrase) before syncing. If the remote blob is plaintext `StoreV2` while encryption is enabled locally, the system SHALL fail with a typed error warning that the remote data is not encrypted, and SHALL NOT push the encrypted local store over it automatically. In both cases local data stays untouched and the user resolves the mismatch explicitly.

#### Scenario: Remote encrypted, local disabled
- **WHEN** encryption is off and the fetched blob parses as an envelope
- **THEN** sync ends in error with a message directing the user to enable encryption, and nothing is uploaded

#### Scenario: Remote plaintext, local enabled
- **WHEN** encryption is on and the fetched blob parses as plaintext StoreV2
- **THEN** sync ends in error asking the user to confirm overwriting the remote plaintext with encrypted data, rather than doing so silently

### Requirement: Enabling, disabling, and changing passphrase
Enabling encryption SHALL re-encrypt the current store and push the encrypted blob on the next sync. Disabling SHALL push the plaintext blob. Changing the passphrase SHALL re-encrypt with the new passphrase and push. Switching modes SHALL NOT lose data: the local store is always the plaintext source of truth.

#### Scenario: Enable encryption on existing backend
- **WHEN** the user enables encryption with a passphrase on an already-syncing backend
- **THEN** the next sync uploads the encrypted envelope and a second device with the passphrase can decrypt it

#### Scenario: Passphrase change
- **WHEN** the user changes the passphrase
- **THEN** the remote blob is re-encrypted under the new passphrase and old-passphrase decryption subsequently fails

### Requirement: Mandatory automated tests for encryption
The project SHALL include automated unit tests covering: encrypt/decrypt round-trip; fresh salt/IV per encryption (two envelopes of the same store differ); wrong-passphrase → typed error with local store untouched; corrupt and unknown-version envelopes → typed errors; sub-minimum iteration envelopes rejected; both mode-mismatch directions; passphrase-change re-encryption; and PBKDF2 iteration count asserted ≥ 600,000 in produced envelopes.

#### Scenario: Crypto suite runs green in Docker
- **WHEN** `make test` is run
- **THEN** all encryption suites above pass inside the Docker container (WebCrypto available in the Node test environment)
