# FooQoo/homebrew-tap

Homebrew tap for Agent Board.

```sh
brew install fooqoo/tap/agboard
brew upgrade fooqoo/tap/agboard
```

`Formula/agboard.rb` is generated, not edited by hand. It requires macOS 15 or
later and installs the prebuilt, signed binary from the Release of the same tag.

## What this repository receives

Only two files change, in one commit on a branch of this repository:

- `Formula/agboard.rb`, rendered by `scripts/release/render-formula.py` in
  FooQoo/agent-board.
- This README, when the install or upgrade wording changes.

Nothing else is copied from FooQoo/agent-board: no archives, no scripts, no
tokens. Nothing pushes to this repository automatically.

## Update procedure (maintainer, after the Release is public)

Update the Formula only when all of these hold. If any fails, leave the Tap as it is.

1. The Release `vX.Y.Z` is published, not a draft, and holds exactly the two
   archives (`aarch64-apple-darwin`, `x86_64-apple-darwin`) and `SHA256SUMS`.
2. Both archives were built, signed with Developer ID and notarized
   (Accepted) before packing. The `SHA256SUMS` comes from those same bytes.
3. Download the published `SHA256SUMS` and both archives into one empty
   directory, and render from them:

   ```sh
   python3 scripts/release/render-formula.py --tag vX.Y.Z \
     --sums <dir>/SHA256SUMS --assets <dir> --out Formula/agboard.rb
   ```

   The command refuses a missing CPU, an archive of another version, an
   unlisted file, or a hash that differs from the downloaded archive, and then
   writes nothing. Rendering again gives the same text.
4. Run `bash scripts/release/test-formula.sh`, then in a local tap:
   `brew style`, `brew audit --strict --new fooqoo/tap/agboard`,
   `brew install fooqoo/tap/agboard`, `brew test fooqoo/tap/agboard`,
   `brew uninstall fooqoo/tap/agboard`.
5. Confirm the install did not change the binary. For each CPU, compare the
   installed `$(brew --prefix agboard)/bin/agboard` with the one extracted from
   the Release archive:

   ```sh
   shasum -a 256 "$(brew --prefix agboard)/bin/agboard" extracted/agboard
   codesign --verify --strict --verbose=2 "$(brew --prefix agboard)/bin/agboard"
   codesign -dv "$(brew --prefix agboard)/bin/agboard" 2>&1 | grep -E 'Identifier|TeamIdentifier|flags'
   ```

   The hashes must be equal, the signature must verify, and the identifier and
   Team ID must equal the Release binary's. Also check that
   `$(brew --prefix agboard)/share/agboard/LICENSE` and
   `THIRD_PARTY_NOTICES.txt` are non-empty and equal the archive's files.
   If anything differs, find the cause and fix it before publishing. Do not
   grant blanket Keychain access or disable Gatekeeper to get past it.
6. Open the commit on a branch and merge it by review. The Formula never
   contains a SHA that was not computed from the published archives.
