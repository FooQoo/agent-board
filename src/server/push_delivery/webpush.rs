//! Web Push message encryption and the VAPID header.
//!
//! The message is encrypted for one browser with RFC 8291 (`aes128gcm` content encoding of
//! RFC 8188): an ephemeral P-256 key agrees a secret with the browser's key, HKDF-SHA256 turns
//! it into a key and a nonce, and AES-128-GCM seals the payload in one record. The push service
//! sees only the ciphertext. The request is identified to the push service with a VAPID
//! signature (RFC 8292): an ES256 JWT whose audience is the push service's origin, sent as
//! `Authorization: vapid t=<jwt>, k=<public key>`.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use ring::aead::{AES_128_GCM, Aad, LessSafeKey, Nonce, UnboundKey};
use ring::agreement::{ECDH_P256, EphemeralPrivateKey, UnparsedPublicKey, agree_ephemeral};
use ring::hkdf::{self, HKDF_SHA256, KeyType};
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::{EcdsaKeyPair, KeyPair};

/// The record size written in the header. One record holds the whole message.
const RECORD_SIZE: u32 = 4096;
/// The header is 16 (salt) + 4 (record size) + 1 (key id length) + 65 (sender key) bytes.
const HEADER_LEN: usize = 86;
/// The longest plaintext that fits in one record with the delimiter and the tag.
pub(super) const MAX_PLAINTEXT: usize = RECORD_SIZE as usize - HEADER_LEN - 1 - 16;
/// How long a VAPID signature is valid. The limit is 24 hours.
const VAPID_LIFETIME_SECONDS: u64 = 12 * 60 * 60;

/// An input that cannot be encrypted or signed (a key of the wrong shape, a payload that is too
/// long). It carries no detail on purpose: nothing about the keys is worth logging.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct CryptoError;

struct Len(usize);

impl KeyType for Len {
    fn len(&self) -> usize {
        self.0
    }
}

fn expand(prk: &hkdf::Prk, info: &[u8], out: &mut [u8]) -> Result<(), CryptoError> {
    prk.expand(&[info], Len(out.len()))
        .and_then(|okm| okm.fill(out))
        .map_err(|_| CryptoError)
}

/// Seal `plaintext` for the browser with the given secret. Split from [`encrypt`] so that the
/// RFC 8291 test vector, which fixes the sender key and the salt, can drive it.
pub(super) fn seal(
    ecdh_secret: &[u8],
    sender_public: &[u8],
    receiver_public: &[u8],
    auth: &[u8],
    salt: &[u8; 16],
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if plaintext.len() > MAX_PLAINTEXT || sender_public.len() != 65 {
        return Err(CryptoError);
    }
    let prk_key = hkdf::Salt::new(HKDF_SHA256, auth).extract(ecdh_secret);
    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(receiver_public);
    key_info.extend_from_slice(sender_public);
    let mut ikm = [0u8; 32];
    expand(&prk_key, &key_info, &mut ikm)?;
    let prk = hkdf::Salt::new(HKDF_SHA256, salt).extract(&ikm);
    let mut cek = [0u8; 16];
    expand(&prk, b"Content-Encoding: aes128gcm\0", &mut cek)?;
    let mut nonce = [0u8; 12];
    expand(&prk, b"Content-Encoding: nonce\0", &mut nonce)?;

    let mut record = plaintext.to_vec();
    record.push(0x02); // The delimiter of the last record.
    let key = LessSafeKey::new(UnboundKey::new(&AES_128_GCM, &cek).map_err(|_| CryptoError)?);
    key.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce),
        Aad::empty(),
        &mut record,
    )
    .map_err(|_| CryptoError)?;

    let mut message = Vec::with_capacity(HEADER_LEN + record.len());
    message.extend_from_slice(salt);
    message.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    message.push(65);
    message.extend_from_slice(sender_public);
    message.extend_from_slice(&record);
    Ok(message)
}

/// Encrypt `plaintext` for a browser's subscription keys (`p256dh`, a 65-byte uncompressed
/// P-256 point, and the 16-byte `auth` secret) with a fresh sender key and salt.
pub(super) fn encrypt(
    receiver_public: &[u8],
    auth: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if receiver_public.len() != 65 || receiver_public[0] != 0x04 || auth.len() != 16 {
        return Err(CryptoError);
    }
    let rng = SystemRandom::new();
    let private = EphemeralPrivateKey::generate(&ECDH_P256, &rng).map_err(|_| CryptoError)?;
    let sender_public = private.compute_public_key().map_err(|_| CryptoError)?;
    let secret = agree_ephemeral(
        private,
        &UnparsedPublicKey::new(&ECDH_P256, receiver_public),
        |secret| secret.to_vec(),
    )
    .map_err(|_| CryptoError)?;
    let mut salt = [0u8; 16];
    rng.fill(&mut salt).map_err(|_| CryptoError)?;
    seal(
        &secret,
        sender_public.as_ref(),
        receiver_public,
        auth,
        &salt,
        plaintext,
    )
}

/// The `Authorization` header value for a push service: `vapid t=<jwt>, k=<public key>`. The
/// audience is the origin of `endpoint`, the expiry is `now_unix` plus 12 hours, and `subject`
/// is a contact address (`mailto:` or `https:`).
pub(super) fn vapid_authorization(
    signer: &EcdsaKeyPair,
    endpoint: &str,
    subject: &str,
    now_unix: u64,
) -> Result<String, CryptoError> {
    let url = url::Url::parse(endpoint).map_err(|_| CryptoError)?;
    let audience = url.origin().ascii_serialization();
    if audience == "null" {
        return Err(CryptoError);
    }
    let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
    let claims = B64.encode(
        serde_json::json!({
            "aud": audience,
            "exp": now_unix + VAPID_LIFETIME_SECONDS,
            "sub": subject,
        })
        .to_string(),
    );
    let signing_input = format!("{header}.{claims}");
    let signature = signer
        .sign(&SystemRandom::new(), signing_input.as_bytes())
        .map_err(|_| CryptoError)?;
    Ok(format!(
        "vapid t={signing_input}.{}, k={}",
        B64.encode(signature.as_ref()),
        B64.encode(signer.public_key().as_ref())
    ))
}

#[cfg(test)]
pub(super) mod tests;
