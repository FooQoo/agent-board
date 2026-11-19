use ring::signature::{ECDSA_P256_SHA256_FIXED, UnparsedPublicKey as Verifier};

use super::*;
use crate::server::monitor_connection::push::PushStore;

fn b64(text: &str) -> Vec<u8> {
    B64.decode(text.replace([' ', '\n'], "")).unwrap()
}

/// RFC 8291, Appendix A: the intermediate values of the example in Section 5.
#[test]
fn seals_the_rfc_8291_example() {
    let sender_public = b64(
        "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    );
    let receiver_public = b64(
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    );
    let message = seal(
        &b64("kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs"),
        &sender_public,
        &receiver_public,
        &b64("BTBZMqHH6r4Tts7J_aSIgg"),
        &b64("DGv6ra1nlYgDCS1FRnbzlw").try_into().unwrap(),
        &b64("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
    )
    .unwrap();
    let header = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    let ciphertext =
        "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ";
    // The header and the ciphertext are base64url of separate byte strings in the RFC.
    assert_eq!(message, [b64(header), b64(ciphertext)].concat());
    assert_eq!(message.len(), HEADER_LEN + 41 + 1 + 16);
}

/// A browser's side of the exchange, with a key made for the test.
pub(in crate::server::push_delivery) struct Browser {
    private: EphemeralPrivateKey,
    pub(in crate::server::push_delivery) public: Vec<u8>,
    pub(in crate::server::push_delivery) auth: [u8; 16],
}

impl Browser {
    pub(in crate::server::push_delivery) fn new() -> Self {
        let rng = SystemRandom::new();
        let private = EphemeralPrivateKey::generate(&ECDH_P256, &rng).unwrap();
        let public = private.compute_public_key().unwrap().as_ref().to_vec();
        let mut auth = [0u8; 16];
        rng.fill(&mut auth).unwrap();
        Self {
            private,
            public,
            auth,
        }
    }

    /// Open a message the way RFC 8291 Section 4 describes.
    pub(in crate::server::push_delivery) fn open(self, message: &[u8]) -> Vec<u8> {
        let salt: [u8; 16] = message[..16].try_into().unwrap();
        assert_eq!(&message[16..20], &RECORD_SIZE.to_be_bytes());
        assert_eq!(message[20], 65);
        let sender_public = &message[21..86];
        let secret = agree_ephemeral(
            self.private,
            &UnparsedPublicKey::new(&ECDH_P256, sender_public),
            |s| s.to_vec(),
        )
        .unwrap();
        let prk_key = hkdf::Salt::new(HKDF_SHA256, &self.auth).extract(&secret);
        let mut info = b"WebPush: info\0".to_vec();
        info.extend_from_slice(&self.public);
        info.extend_from_slice(sender_public);
        let mut ikm = [0u8; 32];
        expand(&prk_key, &info, &mut ikm).unwrap();
        let prk = hkdf::Salt::new(HKDF_SHA256, &salt).extract(&ikm);
        let mut cek = [0u8; 16];
        expand(&prk, b"Content-Encoding: aes128gcm\0", &mut cek).unwrap();
        let mut nonce = [0u8; 12];
        expand(&prk, b"Content-Encoding: nonce\0", &mut nonce).unwrap();
        let key = LessSafeKey::new(UnboundKey::new(&AES_128_GCM, &cek).unwrap());
        let mut record = message[86..].to_vec();
        let plain = key
            .open_in_place(
                Nonce::assume_unique_for_key(nonce),
                Aad::empty(),
                &mut record,
            )
            .unwrap();
        assert_eq!(plain.last(), Some(&0x02));
        plain[..plain.len() - 1].to_vec()
    }
}

#[test]
fn a_fresh_message_opens_with_the_browsers_key() {
    let browser = Browser::new();
    let message = encrypt(&browser.public, &browser.auth, b"hello, phone").unwrap();
    assert_eq!(browser.open(&message), b"hello, phone");
}

#[test]
fn two_messages_for_one_browser_differ() {
    let browser = Browser::new();
    let a = encrypt(&browser.public, &browser.auth, b"same").unwrap();
    let b = encrypt(&browser.public, &browser.auth, b"same").unwrap();
    assert_ne!(a, b);
}

#[test]
fn bad_keys_and_long_payloads_are_refused() {
    let browser = Browser::new();
    assert_eq!(
        encrypt(&browser.public[..64], &browser.auth, b"x"),
        Err(CryptoError)
    );
    assert_eq!(
        encrypt(&browser.public, &browser.auth[..15], b"x"),
        Err(CryptoError)
    );
    let mut not_a_point = browser.public.clone();
    not_a_point[0] = 0x02;
    assert_eq!(encrypt(&not_a_point, &browser.auth, b"x"), Err(CryptoError));
    let long = vec![b'a'; MAX_PLAINTEXT + 1];
    assert_eq!(
        encrypt(&browser.public, &browser.auth, &long),
        Err(CryptoError)
    );
    let longest = vec![b'a'; MAX_PLAINTEXT];
    let message = encrypt(&browser.public, &browser.auth, &longest).unwrap();
    assert_eq!(message.len(), RECORD_SIZE as usize);
}

#[test]
fn the_vapid_header_is_an_es256_jwt_that_the_public_key_verifies() {
    let store = PushStore::in_memory();
    let signer = store.vapid_signer().unwrap();
    let header = vapid_authorization(
        &signer,
        "https://web.push.apple.com:8443/wpush/v2/abc?x=1",
        "https://example.test/contact",
        1_800_000_000,
    )
    .unwrap();
    let rest = header.strip_prefix("vapid t=").unwrap();
    let (jwt, key) = rest.split_once(", k=").unwrap();
    assert_eq!(key, store.public_key().unwrap());

    let parts: Vec<&str> = jwt.split('.').collect();
    assert_eq!(parts.len(), 3);
    let head: serde_json::Value = serde_json::from_slice(&b64(parts[0])).unwrap();
    assert_eq!(head, serde_json::json!({"typ": "JWT", "alg": "ES256"}));
    let claims: serde_json::Value = serde_json::from_slice(&b64(parts[1])).unwrap();
    assert_eq!(claims["aud"], "https://web.push.apple.com:8443");
    assert_eq!(claims["exp"], 1_800_000_000u64 + 12 * 3600);
    assert_eq!(claims["sub"], "https://example.test/contact");
    assert!(claims["exp"].as_u64().unwrap() - 1_800_000_000 <= 24 * 3600);

    let signature = b64(parts[2]);
    assert_eq!(signature.len(), 64);
    let public = b64(key);
    Verifier::new(&ECDSA_P256_SHA256_FIXED, &public)
        .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
        .unwrap();
    assert!(
        Verifier::new(&ECDSA_P256_SHA256_FIXED, &public)
            .verify(b"other", &signature)
            .is_err()
    );
}

#[test]
fn an_endpoint_without_an_origin_gets_no_signature() {
    let signer = PushStore::in_memory().vapid_signer().unwrap();
    assert_eq!(
        vapid_authorization(&signer, "not a url", "https://example.test", 1),
        Err(CryptoError)
    );
}
