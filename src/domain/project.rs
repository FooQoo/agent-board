//! Project identity, catalog and change-cursor types.

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::SkanError;

const ID_LEN: usize = 32;

fn invalid(field: &str, reason: &str) -> SkanError {
    SkanError::InvalidValue {
        field: field.to_string(),
        reason: reason.to_string(),
    }
}

fn is_lower_hex(text: &str) -> bool {
    text.len() == ID_LEN && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// An immutable project identifier: 32 lowercase hexadecimal digits.
///
/// It is generated once when a project is created and never changes, so it
/// keeps pointing at the same project across renames and never at a project
/// that was later created with the same name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ProjectId(String);

impl ProjectId {
    /// Generate a new random identifier. A failure of the system random source
    /// is reported as `database_error`.
    pub fn generate() -> Result<ProjectId, SkanError> {
        let mut bytes = [0u8; ID_LEN / 2];
        getrandom::fill(&mut bytes).map_err(|e| SkanError::DatabaseError {
            reason: e.to_string(),
        })?;
        Ok(ProjectId(
            bytes.iter().map(|b| format!("{b:02x}")).collect(),
        ))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl FromStr for ProjectId {
    type Err = SkanError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if is_lower_hex(s) {
            Ok(ProjectId(s.to_string()))
        } else {
            Err(invalid(
                "projectId",
                "Project IDs are 32 lowercase hexadecimal digits.",
            ))
        }
    }
}

impl fmt::Display for ProjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for ProjectId {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for ProjectId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        text.parse()
            .map_err(|e: SkanError| serde::de::Error::custom(e.reason()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: ProjectId,
    pub name: String,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
}

/// The project list (ordered by name) and the catalog version, read together.
/// The catalog version changes when a project is added, removed, renamed, or
/// its content changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCatalog {
    pub projects: Vec<ProjectMeta>,
    pub catalog_version: String,
}

/// Identifies the state of one project's shared files:
/// `f1:<ProjectId>:<version>`, where the version is 32 lowercase hexadecimal
/// digits computed from the content. A version has no order; a wait only asks
/// whether it is still the same.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ChangeCursor {
    pub project_id: ProjectId,
    pub version: String,
}

impl ChangeCursor {
    pub fn new(project_id: ProjectId, version: &str) -> Result<ChangeCursor, SkanError> {
        if !is_lower_hex(version) {
            return Err(invalid(
                "cursor",
                "A cursor version is 32 lowercase hexadecimal digits.",
            ));
        }
        Ok(ChangeCursor {
            project_id,
            version: version.to_string(),
        })
    }
}

impl FromStr for ChangeCursor {
    type Err = SkanError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let bad = || invalid("cursor", "A cursor looks like f1:<project-id>:<version>.");
        let rest = s.strip_prefix("f1:").ok_or_else(bad)?;
        let (id, version) = rest.split_once(':').ok_or_else(bad)?;
        let project_id: ProjectId = id.parse().map_err(|_| bad())?;
        ChangeCursor::new(project_id, version).map_err(|_| bad())
    }
}

impl fmt::Display for ChangeCursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "f1:{}:{}", self.project_id, self.version)
    }
}

impl Serialize for ChangeCursor {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for ChangeCursor {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        text.parse()
            .map_err(|e: SkanError| serde::de::Error::custom(e.reason()))
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    const ID: &str = "0123456789abcdef0123456789abcdef";
    const VERSION: &str = "fedcba9876543210fedcba9876543210";

    #[test]
    fn project_id_accepts_32_lowercase_hex_digits() {
        let id: ProjectId = ID.parse().unwrap();
        assert_eq!(id.as_str(), ID);
        assert_eq!(id.to_string(), ID);
    }

    #[test]
    fn project_id_rejects_everything_else() {
        for bad in [
            "",
            "0123456789abcdef0123456789abcde",
            "0123456789abcdef0123456789abcdef0",
            "0123456789ABCDEF0123456789ABCDEF",
            "0123456789abcdef0123456789abcdeg",
            " 123456789abcdef0123456789abcdef",
            "0123456789abcdef0123456789abcde\n",
            "0123456789abcdef-123456789abcdef",
            "０123456789abcdef0123456789abcdef",
        ] {
            let err = bad.parse::<ProjectId>().unwrap_err();
            assert!(matches!(err, SkanError::InvalidValue { .. }), "{bad:?}");
        }
    }

    #[test]
    fn generated_ids_are_valid_and_distinct() {
        let a = ProjectId::generate().unwrap();
        let b = ProjectId::generate().unwrap();
        assert_ne!(a, b);
        assert_eq!(a.as_str().parse::<ProjectId>().unwrap(), a);
    }

    #[test]
    fn project_id_serde_is_a_plain_validated_string() {
        let id: ProjectId = ID.parse().unwrap();
        assert_eq!(serde_json::to_string(&id).unwrap(), format!("\"{ID}\""));
        assert_eq!(
            serde_json::from_str::<ProjectId>(&format!("\"{ID}\"")).unwrap(),
            id
        );
        assert!(serde_json::from_str::<ProjectId>("\"nope\"").is_err());
        assert!(serde_json::from_str::<ProjectId>("12").is_err());
    }

    #[test]
    fn project_meta_and_catalog_use_camel_case() {
        let meta = ProjectMeta {
            id: ID.parse().unwrap(),
            name: "A".into(),
            created_at: Utc.with_ymd_and_hms(2026, 10, 2, 1, 8, 0).unwrap(),
        };
        let json = serde_json::to_value(&meta).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"id": ID, "name": "A", "createdAt": "2026-10-02T01:08:00Z"})
        );
        let catalog = ProjectCatalog {
            projects: vec![meta.clone()],
            catalog_version: VERSION.into(),
        };
        let json = serde_json::to_value(&catalog).unwrap();
        assert_eq!(json["catalogVersion"], VERSION);
        assert_eq!(json["projects"][0]["createdAt"], "2026-10-02T01:08:00Z");
        assert_eq!(
            serde_json::from_value::<ProjectCatalog>(json).unwrap(),
            catalog
        );
    }

    #[test]
    fn cursor_is_f1_with_the_project_id_and_a_content_version() {
        let text = format!("f1:{ID}:{VERSION}");
        let cursor: ChangeCursor = text.parse().unwrap();
        assert_eq!(cursor.project_id.as_str(), ID);
        assert_eq!(cursor.version, VERSION);
        assert_eq!(cursor.to_string(), text);
        assert_eq!(
            serde_json::to_string(&cursor).unwrap(),
            format!("\"{text}\"")
        );
        assert_eq!(
            serde_json::from_str::<ChangeCursor>(&format!("\"{text}\"")).unwrap(),
            cursor
        );
    }

    #[test]
    fn cursor_rejects_the_old_revision_form_and_malformed_text() {
        for bad in [
            "".to_string(),
            "f1".to_string(),
            format!("{ID}:42"),
            format!("{ID}:{VERSION}"),
            format!("f1:{ID}"),
            format!("f1:{ID}:"),
            format!("f1:{ID}:{}", &VERSION[1..]),
            format!("f1:{ID}:{VERSION}0"),
            format!("f1:{ID}:{}", VERSION.to_uppercase()),
            format!("f1:{ID}:{VERSION}:x"),
            format!("f2:{ID}:{VERSION}"),
            format!("f1:{}:{VERSION}", ID.to_uppercase()),
            format!("f1:{ID}:{VERSION} "),
            "42".to_string(),
        ] {
            let err = bad.parse::<ChangeCursor>().unwrap_err();
            assert!(matches!(err, SkanError::InvalidValue { .. }), "{bad:?}");
        }
        assert!(serde_json::from_str::<ChangeCursor>("42").is_err());
        assert!(serde_json::from_str::<ChangeCursor>(&format!("\"{ID}:42\"")).is_err());
    }

    #[test]
    fn cursor_built_from_parts_needs_a_lowercase_version() {
        let id: ProjectId = ID.parse().unwrap();
        assert_eq!(
            ChangeCursor::new(id.clone(), VERSION).unwrap().version,
            VERSION
        );
        assert!(ChangeCursor::new(id.clone(), "42").is_err());
        assert!(ChangeCursor::new(id, &VERSION.to_uppercase()).is_err());
    }
}
