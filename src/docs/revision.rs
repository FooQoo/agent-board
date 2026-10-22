//! The revision of a file's content: what a save names as the version it read.

use sha2::{Digest, Sha256};

/// `sha256:<hex>` of the exact bytes.
pub fn revision_of(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut revision = String::from("sha256:");
    for byte in digest {
        revision.push_str(&format!("{byte:02x}"));
    }
    revision
}

#[cfg(test)]
mod tests {
    use super::revision_of;

    #[test]
    fn the_revision_is_the_sha256_of_the_bytes() {
        assert_eq!(
            revision_of(b""),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_ne!(revision_of(b"a\n"), revision_of(b"a\r\n"));
    }
}
